// Outlet Supervisor：唯一持有 Outlet 子进程身份，拒绝 pidfile-only 的误停与假停止。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HABITAT_OUTLET_PORT || 9272);
const STATE_DIR = process.env.HABITAT_OUTLET_STATE_DIR || '/var/lib/habitat/outlets';
const AGENT_TOKEN = fs.readFileSync(process.env.HABITAT_AGENT_TOKEN_FILE || '/etc/habitat/agent.token', 'utf8').trim();
const OWNER_TOKEN = fs.readFileSync(process.env.HABITAT_OWNER_TOKEN_FILE || '/etc/habitat/owner.token', 'utf8').trim();
const RTMP_CONFIG = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/etc/habitat/bilibili-live.json';
const entries = {
  hls: process.env.HABITAT_TEST_HLS_ENTRY || '../tools/wsl-pipeline-up.sh',
  rtmp: '../tools/wsl-rtmp-up.sh',
};
const active = new Map();
const history = new Map();
fs.mkdirSync(STATE_DIR, { recursive: true });

const log = (...args) => console.log(new Date().toISOString(), '[outlet-supervisor]', ...args);
const stateFile = (name) => path.join(STATE_DIR, `${name}.json`);
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function publicInstance(instance) {
  if (!instance) return null;
  return {
    instanceId: instance.id,
    pid: instance.child.pid,
    state: instance.state,
    startedAt: instance.startedAt,
    stopRequested: instance.stopRequested,
  };
}
function publicHistory(name) {
  const h = history.get(name);
  return h ? { ...h, child: undefined } : null;
}
function setHistory(name, value) {
  history.set(name, value);
  writeJson(stateFile(name), value);
}
function validateRtmpConfig() {
  let stat;
  try { stat = fs.statSync(RTMP_CONFIG); } catch { throw new Error('主人尚未配置 B 站推流地址'); }
  if ((stat.mode & 0o077) !== 0) throw new Error('推流配置权限过宽，请 chmod 600');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(RTMP_CONFIG, 'utf8')); } catch { throw new Error('推流配置不是有效 JSON'); }
  if (!/^rtmps?:\/\//.test(cfg.rtmpUrl || '') || !cfg.streamKey) throw new Error('推流配置缺少 rtmpUrl 或 streamKey');
}
for (const name of Object.keys(entries)) {
  try {
    const old = JSON.parse(fs.readFileSync(stateFile(name), 'utf8'));
    if (['starting', 'running', 'stopping'].includes(old.state)) {
      // 不根据旧 PID 杀进程。systemd 负责控制组；旧身份只保留为诊断。
      setHistory(name, { ...old, state: 'interrupted', stoppedAt: Date.now(), lastError: 'supervisor restarted' });
      log('previous instance marked interrupted', name, old.instanceId || 'unknown');
    } else {
      history.set(name, old);
    }
  } catch {}
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error('body too large');
  }
  return JSON.parse(text || '{}');
}
function role(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (token === OWNER_TOKEN) return 'owner';
  if (token === AGENT_TOKEN) return 'agent';
  return null;
}
function authorize(req, name) {
  const r = role(req);
  if (r === 'owner' || (r === 'agent' && name === 'hls')) return true;
  const e = new Error(r ? 'scope denied' : 'token required');
  e.code = 403;
  throw e;
}
function configured(name) {
  return name === 'rtmp' ? fs.existsSync(RTMP_CONFIG) : true;
}
function status() {
  return Object.fromEntries(Object.keys(entries).map((name) => {
    const instance = active.get(name);
    return [name, {
      configured: configured(name),
      running: !!instance && instance.state !== 'stopping',
      ...(publicInstance(instance) || publicHistory(name) || { state: 'stopped', instanceId: null, pid: null }),
    }];
  }));
}

function start(name) {
  if (!entries[name]) throw new Error('unknown outlet: ' + name);
  if (name === 'rtmp') validateRtmpConfig();
  const existing = active.get(name);
  if (existing) return { accepted: false, already: true, ...publicInstance(existing) };
  const id = crypto.randomUUID();
  const child = process.env.HABITAT_TEST_CHILD_MODE === 'node'
    ? spawn(process.execPath, [process.env.HABITAT_TEST_CHILD_FILE], {
      cwd: path.join(ROOT, '..'),
      stdio: 'ignore',
      detached: false,
      env: { ...process.env, FB_HLS: name === 'hls' ? '1' : '0' },
    })
    : spawn('/usr/bin/env', ['bash', path.join(ROOT, entries[name])], {
      cwd: path.join(ROOT, '..'),
      stdio: 'ignore',
      detached: false,
      env: { ...process.env, FB_HLS: name === 'hls' ? '1' : '0' },
    });
  const instance = {
    id, name, child, state: 'starting', startedAt: Date.now(), stopRequested: false,
    exited: null, exitInfo: null,
  };
  instance.exited = new Promise((resolve) => { instance.resolveExit = resolve; });
  active.set(name, instance);
  setHistory(name, { ...publicInstance(instance), name });
  child.once('spawn', () => {
    if (active.get(name) !== instance) return;
    instance.state = 'running';
    setHistory(name, { ...publicInstance(instance), name });
    log('process running', name, id, child.pid);
  });
  child.once('error', (error) => finish(instance, { error: error.message }));
  child.once('exit', (code, signal) => finish(instance, { code, signal }));
  return { accepted: true, ...publicInstance(instance) };
}
function finish(instance, info) {
  const { name, id } = instance;
  if (instance.exitInfo) return;
  instance.exitInfo = info;
  const failed = info.error || (!instance.stopRequested && info.code !== 0);
  const value = {
    name,
    instanceId: id,
    pid: instance.child.pid,
    state: failed ? 'failed' : 'stopped',
    startedAt: instance.startedAt,
    stoppedAt: Date.now(),
    exitCode: info.code ?? null,
    signal: info.signal || null,
    lastError: info.error || null,
  };
  if (active.get(name) === instance) active.delete(name);
  setHistory(name, value);
  instance.resolveExit(value);
  log('process exit', name, id, JSON.stringify(value));
}
async function stop(name) {
  if (!entries[name]) throw new Error('unknown outlet: ' + name);
  const instance = active.get(name);
  if (!instance) return { accepted: false, alreadyStopped: true, name };
  instance.stopRequested = true;
  instance.state = 'stopping';
  setHistory(name, { ...publicInstance(instance), name });
  const id = instance.id;
  try { instance.child.kill('SIGTERM'); } catch {}
  let result = await Promise.race([
    instance.exited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  if (result === 'timeout') {
    log('stop timeout; escalating SIGKILL', name, id);
    try { instance.child.kill('SIGKILL'); } catch {}
    result = await Promise.race([
      instance.exited,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000)),
    ]);
  }
  if (result === 'timeout') return { accepted: true, stopped: false, error: 'stop_timeout', instanceId: id };
  return { accepted: true, stopped: result.state === 'stopped', ...result };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      return json(res, 200, status());
    }
    const match = url.pathname.match(/^\/outlets\/(start|stop)$/);
    if (req.method === 'POST' && match) {
      const { name } = await body(req);
      authorize(req, name);
      return json(res, 200, match[1] === 'start' ? start(name) : await stop(name));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, Number(e.code) || 400, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => log(`listening 127.0.0.1:${PORT}`));

async function shutdown() {
  await Promise.all([...active.keys()].map((name) => stop(name).catch(() => {})));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
