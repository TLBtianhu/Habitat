// 推流网络策略：RTMP 直连/系统路径/SOCKS5 分离，预检只验证连通性，不证明直播成功。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { ProxyAgent } from 'undici';
import { Socks5Relay, connectSocks5 } from './socks5-relay.mjs';

const DEFAULTS = {
  mode: 'direct',
  directHosts: ['live-push.bilivideo.com'],
  apiProxyMode: 'system',
  allowSystemProxyForRtmp: false,
  proxy: { host: '127.0.0.1', port: 7897, username: '', password: '' },
};

function directEnv(hosts) {
  const noProxy = [...new Set([...hosts, '127.0.0.1', 'localhost'])].join(',');
  return { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: noProxy, no_proxy: noProxy };
}

function safeError(error) {
  return String(error?.message || error).replace(/(?:rtmps?|https?):\/\/\S+/gi, '[url]').slice(0, 400);
}

function normalize(value) {
  const next = { ...DEFAULTS, ...value, proxy: { ...DEFAULTS.proxy, ...(value?.proxy || {}) } };
  if (!['direct', 'system', 'socks5'].includes(next.mode)) throw new Error('unsupported RTMP network mode');
  if (!['direct', 'system'].includes(next.apiProxyMode)) throw new Error('unsupported API proxy mode');
  if (!Array.isArray(next.directHosts) || !next.directHosts.length || next.directHosts.length > 20 || next.directHosts.some((host) => typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host))) throw new Error('invalid directHosts');
  next.allowSystemProxyForRtmp = Boolean(next.allowSystemProxyForRtmp);
  next.proxy.host = String(next.proxy.host || '').trim();
  next.proxy.port = Number(next.proxy.port);
  if (next.mode === 'socks5' && (!next.proxy.host || !Number.isSafeInteger(next.proxy.port) || next.proxy.port < 1 || next.proxy.port > 65535)) throw new Error('SOCKS5 host and port required');
  next.proxy.username = String(next.proxy.username || '');
  next.proxy.password = String(next.proxy.password || '');
  if (next.proxy.username.length > 255 || next.proxy.password.length > 255) throw new Error('SOCKS5 credentials too long');
  return next;
}

function publicConfig(config) {
  return {
    mode: config.mode,
    directHosts: config.directHosts,
    apiProxyMode: config.apiProxyMode,
    allowSystemProxyForRtmp: config.allowSystemProxyForRtmp,
    proxyConfigured: config.mode === 'socks5',
    proxyHost: config.mode === 'socks5' ? config.proxy.host : null,
    proxyPort: config.mode === 'socks5' ? config.proxy.port : null,
    hasProxyAuth: Boolean(config.proxy.username),
  };
}

export class RtmpNetworkPolicy {
  constructor({ file = process.env.HABITAT_STREAM_NETWORK_CONFIG || '/opt/habitat/config/stream-network.json' } = {}) {
    this.file = file;
    this.config = this.read();
    this.lastCheckedAt = null;
    this.lastResult = 'unknown';
    this.lastError = null;
  }

  read() {
    if (!fs.existsSync(this.file)) return normalize(DEFAULTS);
    return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  status() {
    return { ...publicConfig(this.config), supported: this.config.mode !== 'system' || this.config.allowSystemProxyForRtmp, lastCheckedAt: this.lastCheckedAt, lastResult: this.lastResult, lastError: this.lastError };
  }

  save(body) {
    const previousPassword = this.config.proxy.password;
    const next = normalize({ ...this.config, ...body, proxy: { ...this.config.proxy, ...(body.proxy || {}) } });
    if (body.proxy && !Object.hasOwn(body.proxy, 'password')) next.proxy.password = previousPassword;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.config = next;
    this.lastResult = 'unknown';
    this.lastError = null;
    return this.status();
  }

  apiDispatcher() {
    if (this.config.apiProxyMode !== 'system') return undefined;
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    return proxy ? new ProxyAgent(proxy) : undefined;
  }

  async route(target) {
    const mode = this.config.mode;
    if (mode === 'system') {
      if (!this.config.allowSystemProxyForRtmp) throw new Error('system proxy for RTMP is disabled');
      return { target, env: process.env, close: async () => {} };
    }
    if (mode === 'socks5') {
      const url = new URL(target);
      const relay = new Socks5Relay({
        proxyHost: this.config.proxy.host,
        proxyPort: this.config.proxy.port,
        destinationHost: url.hostname,
        destinationPort: Number(url.port || (url.protocol === 'rtmps:' ? 443 : 1935)),
        username: this.config.proxy.username,
        password: this.config.proxy.password,
      });
      await relay.start();
      url.hostname = '127.0.0.1';
      url.port = relay.port;
      return { target: url.toString(), env: directEnv(this.config.directHosts), tcUrl: target, close: () => relay.stop() };
    }
    return { target, env: directEnv(this.config.directHosts), close: async () => {} };
  }

  async check(target) {
    this.lastCheckedAt = Date.now();
    try {
      const url = new URL(target);
      if (!['rtmp:', 'rtmps:'].includes(url.protocol) || !url.hostname) throw new Error('invalid RTMP URL');
      const destinationPort = Number(url.port || (url.protocol === 'rtmps:' ? 443 : 1935));
      if (this.config.mode === 'socks5') {
        const { socket } = await connectSocks5({
          proxyHost: this.config.proxy.host,
          proxyPort: this.config.proxy.port,
          destinationHost: url.hostname,
          destinationPort,
          username: this.config.proxy.username,
          password: this.config.proxy.password,
        });
        socket.destroy();
      } else {
        await new Promise((resolve, reject) => {
          const socket = net.connect({ host: url.hostname, port: destinationPort, timeout: 8000 });
          socket.once('connect', () => { socket.destroy(); resolve(); });
          socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
          socket.once('error', reject);
        });
      }
      this.lastResult = 'reachable';
      this.lastError = null;
    } catch (error) {
      this.lastResult = 'degraded';
      this.lastError = safeError(error);
    }
    return this.status();
  }
}
