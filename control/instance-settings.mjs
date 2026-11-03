// 安装实例设置：脱敏读取、校验后保存、由 supervisor 应用；secret 永不回显。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const exists = (file) => fs.existsSync(file);
const readSecret = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const writeAtomic = (file, data, mode = 0o600) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
};
const error = (code, message) => Object.assign(new Error(message), { code });

export function computeSettingsHash(configDir) {
  const hash = crypto.createHash('sha256');
  for (const name of ['instance.json', 'llm.json', 'napcat.token', 'bilibili-cookies.txt', 'mcpfabric.token']) {
    const file = path.join(configDir, name);
    hash.update(name);
    hash.update(exists(file) ? fs.readFileSync(file) : Buffer.alloc(0));
  }
  return hash.digest('hex');
}

function validHttpUrl(value, { ws = false } = {}) {
  try {
    const url = new URL(value);
    const protocols = ws ? ['ws:', 'wss:'] : ['http:', 'https:'];
    if (!protocols.includes(url.protocol) || url.username || url.password) return false;
    return true;
  } catch { return false; }
}

export class InstanceSettings {
  constructor({ root = process.env.HABITAT_INSTANCE_ROOT, fetchImpl = fetch } = {}) {
    this.root = root || '';
    this.configDir = this.root ? path.join(this.root, 'config') : '';
    this.dataDir = this.root ? path.join(this.root, 'data') : '';
    this.fetch = fetchImpl;
  }

  _available() {
    if (!this.root || !this.configDir) throw error(409, 'settings are only available for an installed instance');
  }

  _instance() {
    return readJson(path.join(this.configDir, 'instance.json'), {
      schemaVersion: 1, publicStreaming: false, agent: true,
      applications: { qq: false, bilibili: false, mc: false }, connections: {},
    });
  }

  _llm() {
    return readJson(path.join(this.configDir, 'llm.json'), null);
  }

  _status() {
    return readJson(path.join(this.dataDir, 'instance-status.json'), {});
  }

  _public() {
    const instance = this._instance();
    const llm = this._llm();
    const status = this._status();
    const currentHash = computeSettingsHash(this.configDir);
    const pending = status.appliedConfigHash !== currentHash;
    const failed = Object.values(status.services || {}).some((service) => service.state === 'failed');
    return {
      agent: instance.agent !== false,
      applications: {
        qq: instance.applications?.qq === true,
        bilibili: instance.applications?.bilibili === true,
        mc: instance.applications?.mc === true,
      },
      connections: {
        qq: {
          wsUrl: instance.connections?.qq?.wsUrl || '',
          httpUrl: instance.connections?.qq?.httpUrl || '',
          tokenSet: Boolean(readSecret(path.join(this.configDir, 'napcat.token'))),
        },
        bilibili: {
          roomId: Number(instance.connections?.bilibili?.roomId || 0),
          cookieSet: Boolean(readSecret(path.join(this.configDir, 'bilibili-cookies.txt'))),
        },
        mc: {
          configurable: true,
          topology: instance.connections?.mc?.topology || 'local-wsl',
          serverAddress: instance.connections?.mc?.serverAddress || '127.0.0.1:25565',
          rpcUrl: instance.connections?.mc?.rpcUrl || 'http://127.0.0.1:25600/rpc',
          autoStart: instance.connections?.mc?.autoStart === true,
          tokenSet: Boolean(readSecret(path.join(this.configDir, 'mcpfabric.token'))),
        },
      },
      llm: llm ? {
        configured: true,
        provider: llm.provider || 'openai-compatible',
        baseUrl: llm.baseUrl || '',
        model: llm.model || '',
        apiKeySet: Boolean(llm.apiKey),
        timeoutMs: llm.timeoutMs || 30000,
        maxTokens: llm.maxTokens || 300,
        temperature: llm.temperature ?? 0.3,
      } : { configured: false, provider: 'openai-compatible', baseUrl: '', model: '', apiKeySet: false },
      apply: {
        state: pending ? 'pending' : (failed ? 'degraded' : 'applied'),
        configurationRequired: status.configurationRequired || [],
        settingsRevision: instance.settingsRevision || 0,
      },
    };
  }

  get() {
    this._available();
    return this._public();
  }

  async _testLlm(config) {
    if (!validHttpUrl(config.baseUrl)) throw error(400, 'LLM baseUrl must be HTTP(S) without embedded credentials');
    if (!config.model || typeof config.model !== 'string') throw error(400, 'LLM model required');
    if (!config.apiKey) throw error(400, 'LLM apiKey required');
    const base = config.baseUrl.replace(/\/$/, '');
    const response = await this.fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw error(400, `LLM connection failed: HTTP ${response.status}`);
    await response.arrayBuffer();
  }

  async _testQq(connection, token) {
    if (!validHttpUrl(connection.wsUrl, { ws: true })) throw error(400, 'QQ wsUrl must be WS(S)');
    if (!validHttpUrl(connection.httpUrl)) throw error(400, 'QQ httpUrl must be HTTP(S)');
    if (!token) throw error(400, 'QQ token required');
    const response = await this.fetch(`${connection.httpUrl.replace(/\/$/, '')}/get_login_info`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.retcode !== 0) throw error(400, 'QQ backend login verification failed');
  }

  async _testBilibili(roomId) {
    if (!Number.isSafeInteger(roomId) || roomId <= 0) throw error(400, 'Bilibili roomId must be a positive integer');
    const response = await this.fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.code !== 0) throw error(400, 'Bilibili room verification failed');
  }

  async _testMc(connection, token) {
    if (!['local-wsl', 'windows-host', 'remote'].includes(connection.topology)) throw error(400, 'MC topology must be local-wsl, windows-host or remote');
    if (!validHttpUrl(connection.rpcUrl)) throw error(400, 'MC rpcUrl must be HTTP(S)');
    if (connection.topology === 'remote' && new URL(connection.rpcUrl).protocol !== 'https:') throw error(400, 'remote MC RPC must use HTTPS');
    if (!/^[A-Za-z0-9._:-]+$/.test(connection.serverAddress || '')) throw error(400, 'MC serverAddress must be host:port');
    if (connection.autoStart === true && connection.topology !== 'local-wsl') throw error(400, 'MC autoStart is only supported for local-wsl');
    if (connection.autoStart === true) return;
    if (!token) throw error(400, 'mcpfabric token required');
    const response = await this.fetch(connection.rpcUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.info', params: {} }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw error(400, 'MC RPC session verification failed');
  }

  async save(body = {}) {
    this._available();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'settings body must be an object');
    const current = this._instance();
    const next = {
      ...current,
      settingsRevision: (current.settingsRevision || 0) + 1,
      agent: body.agent === undefined ? current.agent !== false : body.agent,
      applications: { ...current.applications, ...(body.applications || {}) },
      connections: {
        ...current.connections,
        qq: { ...current.connections?.qq, ...(body.connections?.qq || {}) },
        bilibili: { ...current.connections?.bilibili, ...(body.connections?.bilibili || {}) },
        mc: { ...current.connections?.mc, ...(body.connections?.mc || {}) },
      },
    };
    if (typeof next.agent !== 'boolean') throw error(400, 'agent must be boolean');
    for (const name of ['qq', 'bilibili', 'mc']) {
      if (typeof next.applications[name] !== 'boolean') throw error(400, `${name} enabled flag must be boolean`);
    }
    const currentLlm = this._llm();
    const llmBody = body.llm || null;
    const nextLlm = llmBody ? {
      provider: 'openai-compatible',
      baseUrl: String(llmBody.baseUrl || currentLlm?.baseUrl || '').trim().replace(/\/$/, ''),
      model: String(llmBody.model || currentLlm?.model || '').trim(),
      apiKey: String(llmBody.apiKey || currentLlm?.apiKey || '').trim(),
      timeoutMs: Number(llmBody.timeoutMs || currentLlm?.timeoutMs || 30000),
      maxTokens: Number(llmBody.maxTokens || currentLlm?.maxTokens || 300),
      temperature: Number(llmBody.temperature ?? currentLlm?.temperature ?? 0.3),
    } : currentLlm;
    if (nextLlm && (!Number.isSafeInteger(nextLlm.timeoutMs) || nextLlm.timeoutMs < 1000 || nextLlm.timeoutMs > 120000)) throw error(400, 'invalid LLM timeoutMs');
    if (nextLlm && (!Number.isSafeInteger(nextLlm.maxTokens) || nextLlm.maxTokens < 1 || nextLlm.maxTokens > 8192)) throw error(400, 'invalid LLM maxTokens');
    if (nextLlm && (!Number.isFinite(nextLlm.temperature) || nextLlm.temperature < 0 || nextLlm.temperature > 2)) throw error(400, 'invalid LLM temperature');
    const qqToken = String(body.connections?.qq?.token || readSecret(path.join(this.configDir, 'napcat.token'))).trim();
    const biliCookie = String(body.connections?.bilibili?.cookie || readSecret(path.join(this.configDir, 'bilibili-cookies.txt'))).trim();
    const mcToken = String(body.connections?.mc?.token || readSecret(path.join(this.configDir, 'mcpfabric.token'))).trim();

    if (llmBody) await this._testLlm(nextLlm);
    if (next.applications.qq && (next.applications.qq !== current.applications?.qq || body.connections?.qq)) {
      await this._testQq(next.connections.qq, qqToken);
    }
    if (next.applications.bilibili && (next.applications.bilibili !== current.applications?.bilibili || body.connections?.bilibili)) {
      await this._testBilibili(Number(next.connections.bilibili.roomId));
    }
    if (next.applications.mc && (next.applications.mc !== current.applications?.mc || body.connections?.mc)) {
      await this._testMc(next.connections.mc, mcToken);
    }

    const files = new Map();
    if (llmBody) files.set(path.join(this.configDir, 'llm.json'), JSON.stringify(nextLlm, null, 2));
    if (body.connections?.qq?.token) files.set(path.join(this.configDir, 'napcat.token'), qqToken);
    if (body.connections?.bilibili?.cookie) files.set(path.join(this.configDir, 'bilibili-cookies.txt'), biliCookie);
    if (body.connections?.mc?.token) files.set(path.join(this.configDir, 'mcpfabric.token'), mcToken);
    files.set(path.join(this.configDir, 'instance.json'), JSON.stringify(next, null, 2));
    const backups = new Map([...files.keys()].map((file) => [file, exists(file) ? fs.readFileSync(file) : null]));
    try {
      for (const [file, content] of files) writeAtomic(file, content);
    } catch (cause) {
      for (const [file, previous] of backups) {
        if (previous === null) fs.rmSync(file, { force: true });
        else writeAtomic(file, previous);
      }
      throw cause;
    }
    return { saved: true, ...this._public(), apply: { ...this._public().apply, state: 'pending' } };
  }
}
