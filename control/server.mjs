// Habitat 控制面：任务、批准、激活、停运；Core 只接受主人授权的系统级动作
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { start as adapterStart, stop as adapterStop, status as adapterStatus } from './adapter-host.mjs';
import { start as outletStart, stop as outletStop, status as outletStatus } from './outlet-host.mjs';
import { OneBotClient } from '../clients/onebot.mjs';
import { loadChannelPolicy } from '../agent/residence-policy.mjs';
import { CrossChannelTasks } from './cross-channel.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_ORIGIN = process.env.HABITAT_STAGE || 'http://127.0.0.1:9230';
const VOICE_ORIGIN = process.env.HABITAT_VOICE || 'http://127.0.0.1:9270';

const OWNER_TOKEN_PATH = '/etc/habitat/owner.token';
function ownerToken() {
  try { return fs.readFileSync(OWNER_TOKEN_PATH, 'utf8').trim(); } catch {
    const t = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync('/etc/habitat', { recursive: true });
    fs.writeFileSync(OWNER_TOKEN_PATH, t, { mode: 0o600 });
    try { fs.chownSync(OWNER_TOKEN_PATH, 1000, 1000); } catch {}
    return t;
  }
}
const TOKEN = ownerToken();
const AGENT_TOKEN_PATH = '/etc/habitat/agent.token';
function agentToken() {
  try { return fs.readFileSync(AGENT_TOKEN_PATH, 'utf8').trim(); } catch {
    const t = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(AGENT_TOKEN_PATH, t, { mode: 0o600 });
    try { fs.chownSync(AGENT_TOKEN_PATH, 1000, 1000); } catch {}
    return t;
  }
}
const AGENT_TOKEN = agentToken();
const CHAT_LOG = process.env.HABITAT_CHAT_LOG || '/var/lib/habitat/system-chat.jsonl';
function loadChat() {
  try {
    return fs.readFileSync(CHAT_LOG, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const m = JSON.parse(line);
        return m && Number.isSafeInteger(m.id) && typeof m.text === 'string' ? [m] : [];
      } catch { return []; }
    }).slice(-200);
  } catch { return []; }
}
const persistedChat = loadChat();
const TASKS_FILE = process.env.HABITAT_TASKS_FILE || '/var/lib/habitat/control-tasks.json';
function loadTasks() {
  try {
    const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    return Array.isArray(tasks) ? tasks.filter((t) => Number.isSafeInteger(t.id) && typeof t.status === 'string') : [];
  } catch { return []; }
}
const persistedTasks = loadTasks();
function persistTasks() {
  const tmp = `${TASKS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state.tasks, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, TASKS_FILE);
}

const state = {
  core: { version: '0.2.0', phase: 'PLAY' },
  adapters: {
    bilibili: { version: '0.1.0', status: 'active' },
    qq: { version: '0.1.0', status: 'active' },
    mc: { version: '0.1.0', status: 'active' },
  },
  tasks: persistedTasks,
  chat: persistedChat,
};
let nextId = persistedTasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
let nextChatId = persistedChat.reduce((max, m) => Math.max(max, m.id), 0) + 1;
const policy = loadChannelPolicy(process.env.HABITAT_RESIDENCE_POLICY || '/etc/habitat/residence-policy.json');
const onebotToken = String(process.env.NAPCAT_TOKEN || '').trim() || (
  fs.existsSync('/etc/habitat/napcat.token') ? fs.readFileSync('/etc/habitat/napcat.token', 'utf8').trim() : ''
);
const onebotClient = new OneBotClient({ httpUrl: process.env.HABITAT_ONEBOT_HTTP_URL || 'http://127.0.0.1:3003', accessToken: onebotToken });
const crossChannel = new CrossChannelTasks({
  policy,
  onebotClient,
  outboxFile: process.env.HABITAT_CONTROL_OUTBOX || '/var/lib/habitat/outbox/control-tasks.json',
  afterAction: new AfterActionStore({ file: process.env.HABITAT_AFTER_ACTION_FILE || '/var/lib/habitat/after-action.jsonl' }),
});
const log = (...a) => console.log(new Date().toISOString(), ...a);

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
function isOwner(req) {
  const auth = req.headers.authorization || '';
  const q = new URL(req.url, 'http://x').searchParams.get('token');
  return auth === `Bearer ${TOKEN}` || q === TOKEN;
}
function isAgent(req) {
  return (req.headers.authorization || '') === `Bearer ${AGENT_TOKEN}`;
}
async function readJson(req) {
  let body = '';
  for await (const c of req) body += c;
  return JSON.parse(body || '{}');
}
async function postSystemChat(req, res, from) {
  const p = await readJson(req);
  const msg = {
    id: nextChatId++,
    channel: 'system',
    from,
    text: String(p.text || '').slice(0, 300),
    at: Date.now(),
  };
  if (!msg.text.trim()) return json(res, 400, { error: 'text required' });
  try {
    fs.mkdirSync(path.dirname(CHAT_LOG), { recursive: true });
    fs.appendFileSync(CHAT_LOG, JSON.stringify(msg) + '\n', { mode: 0o600 });
  } catch (e) {
    return json(res, 500, { error: 'chat persistence failed: ' + e.message });
  }
  state.chat.push(msg);
  if (state.chat.length > 200) state.chat.shift();
  return json(res, 200, msg);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }

  // Voice 只读拉流与状态代理；创建 Utterance 仍需 agent 凭证。
  if (url.pathname.startsWith('/voice/')) {
    const upstreamPath = url.pathname.slice('/voice'.length) || '/';
    const up = http.request(VOICE_ORIGIN + upstreamPath + url.search, {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        authorization: req.headers.authorization || '',
      },
      timeout: 35000,
    }, (r) => {
      const h = { ...r.headers };
      delete h.connection;
      res.writeHead(r.statusCode || 502, h);
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('voice timeout')));
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'voice unavailable' }));
    });
    req.pipe(up);
    return;
  }

  // 只读转发给舞台服务：HLS 与播放器库。控制面和舞台是两个进程，
  // 但浏览器只面对控制面一个源，省掉跨源和硬编码端口。
  if (url.pathname === '/live/status' || url.pathname === '/hls.min.js' || url.pathname.startsWith('/hls/')) {
    const up = http.request(
      STAGE_ORIGIN + url.pathname + url.search,
      { method: 'GET', timeout: 5000 },
      (r) => {
        const h = { ...r.headers };
        delete h.connection;
        res.writeHead(r.statusCode || 502, h);
        r.pipe(res);
      },
    );
    up.on('timeout', () => up.destroy(new Error('stage timeout')));
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('stage unavailable');
    });
    up.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/console.html')) {
    fs.readFile(path.join(HERE, 'console.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('console.html missing');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, state);
  if (req.method === 'GET' && url.pathname === '/presence') {
    try {
      return json(res, 200, JSON.parse(fs.readFileSync('/var/lib/habitat/pump/presence.json', 'utf8')));
    } catch {
      return json(res, 200, { aggregate: 'unknown', residences: [] });
    }
  }
  if (req.method === 'GET' && url.pathname === '/qq/status') {
    try {
      return json(res, 200, JSON.parse(fs.readFileSync('/var/lib/habitat/pump/onebot-status.json', 'utf8')));
    } catch {
      return json(res, 200, { state: 'disabled' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/pump/status') {
    try {
      const p = JSON.parse(fs.readFileSync('/var/lib/habitat/pump/system-chat.json', 'utf8'));
      return json(res, 200, {
        source: p.source,
        watermark: p.watermark,
        pending: p.pending?.length || 0,
        deadLetter: p.deadLetter?.length || 0,
        lastPollAt: p.lastPollAt,
        lastSuccessAt: p.lastSuccessAt,
        lastError: p.lastError,
        reconnectAttempt: p.reconnectAttempt,
        nextRetryAt: p.nextRetryAt,
      });
    } catch (e) {
      return json(res, 200, { source: 'system', pending: 0, deadLetter: 0, lastError: 'pump_not_initialized' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/tasks') return json(res, 200, state.tasks);
  if (req.method === 'GET' && (url.pathname === '/system/chat' || url.pathname === '/chat')) {
    const since = Number(url.searchParams.get('since') || 0);
    return json(res, 200, state.chat.filter((m) => m.id > since).slice(-50));
  }
  if (req.method === 'POST' && url.pathname === '/system/chat/agent') {
    if (!isAgent(req)) return json(res, 403, { error: 'agent required' });
    return postSystemChat(req, res, 'dafeiyu');
  }
  if (req.method === 'POST' && (url.pathname === '/system/chat' || url.pathname === '/chat')) {
    // 身份由凭证决定，调用者不能冒充 owner 或 dafeiyu。
    return postSystemChat(req, res, isOwner(req) ? 'owner' : 'viewer');
  }

  if (req.method === 'POST' && url.pathname === '/tasks') {
    // AI 可发起任务，但不能自己批准
    let body = '';
    for await (const c of req) body += c;
    const p = JSON.parse(body || '{}');
    const isCross = p.type === 'cross_channel.message';
    if (isCross && !isOwner(req)) return json(res, 403, { error: 'owner required for cross-channel task' });
    const t = { id: nextId++, type: p.type || 'adapter.update', name: p.name || 'unknown', version: p.version || '0.0.0', status: 'pending', createdAt: Date.now() };
    if (isCross) {
      t.sourceResidenceId = p.sourceResidenceId || 'system';
      t.targetResidenceId = String(p.targetResidenceId || '');
      t.text = String(p.text || '');
      if (!t.targetResidenceId || !t.text.trim()) return json(res, 400, { error: 'targetResidenceId and text required' });
    }
    state.tasks.push(t);
    persistTasks();
    log('task created', t.id, t.type, t.name);
    return json(res, 200, t);
  }

  const m = url.pathname.match(/^\/tasks\/(\d+)\/(approve|reject)$/);
  if (req.method === 'POST' && m) {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    const t = state.tasks.find((x) => x.id === Number(m[1]));
    if (!t) return json(res, 404, { error: 'not found' });
    if (t.status !== 'pending') return json(res, 409, { error: 'already decided' });
    if (t.type === 'cross_channel.message') {
      t.status = 'approved';
      t.decidedAt = Date.now();
      try {
        t.result = await crossChannel.execute(t);
        t.status = 'succeeded';
      } catch (e) {
        t.status = 'failed';
        t.error = e.message;
      }
      persistTasks();
      return json(res, 200, t);
    }
    t.status = m[2] === 'approve' ? 'approved' : 'rejected';
    if (m[2] === 'approve') {
      if (t.type === 'outlet.start') {
        if (t.name !== 'bilibili-rtmp') {
          t.status = 'error';
          t.error = 'unknown public outlet';
          return json(res, 400, t);
        }
        try {
          t.result = await outletStart('rtmp');
        } catch (e) {
          t.status = 'error';
          t.error = e.message;
          return json(res, 400, t);
        }
      } else {
        const name = t.name.replace(/-adapter$/, '');
        if (state.adapters[name]) {
          adapterStop(name);
          const started = adapterStart(name);
          state.adapters[name].version = t.version;
          state.adapters[name].status = started.started ? 'active' : 'error';
        }
      }
      log('approved', t.id, t.type, t.name);
    }
    t.decidedAt = Date.now();
    persistTasks();
    return json(res, 200, t);
  }

  if (req.method === 'POST' && url.pathname === '/adapters/start') {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    let body = '';
    for await (const c of req) body += c;
    const { name } = JSON.parse(body || '{}');
    return json(res, 200, adapterStart(name));
  }
  if (req.method === 'POST' && url.pathname === '/adapters/stop') {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    let body = '';
    for await (const c of req) body += c;
    const { name } = JSON.parse(body || '{}');
    return json(res, 200, adapterStop(name));
  }
  if (req.method === 'GET' && url.pathname === '/adapters/status') return json(res, 200, adapterStatus());

  if (req.method === 'GET' && url.pathname === '/outlets/status') return json(res, 200, await outletStatus());
  if (req.method === 'POST' && url.pathname === '/outlets/start') {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    let body = '';
    for await (const c of req) body += c;
    const { name } = JSON.parse(body || '{}');
    try { return json(res, 200, await outletStart(name)); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/outlets/stop') {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    let body = '';
    for await (const c of req) body += c;
    const { name } = JSON.parse(body || '{}');
    try { return json(res, 200, await outletStop(name)); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    if (!isOwner(req)) return json(res, 403, { error: 'owner required' });
    state.core.phase = 'STOPPED';
    try { await outletStop('rtmp'); } catch {}
    try { await outletStop('hls'); } catch {}
    log('core stopped by owner; outlets stopped');
    return json(res, 200, state.core);
  }
  json(res, 404, { error: 'not found' });
}).listen(Number(process.env.HABITAT_CONTROL_PORT || 9240), '127.0.0.1', () => log('[control] 127.0.0.1:9240 owner token at', OWNER_TOKEN_PATH));
