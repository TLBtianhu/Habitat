// Fishbowl 宿主侧桥
// - 127.0.0.1:9224：等 Worker 连进来（role=body 或 bot）
// - 127.0.0.1:9225：只读状态 + 最新帧 + 控制口（/nav /eval /click /obs /world）
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

if (process.env.HABITAT_ENABLE_LEGACY_BRIDGE !== '1') {
  console.error('旧 9224/9225 无鉴权桥默认禁用；请使用 mcpfabric、Control 与 Desktop CaptureSession。');
  process.exit(1);
}

const LINK_PORT = 9224;
const API_PORT = 9225;
const ART = process.env.FB_ART || 'C:/Habitat/artifacts';
fs.mkdirSync(ART, { recursive: true });

const state = {
  body: null,
  bot: null,
  caps: {},
  frames: 0,
  lastFrameAt: 0,
  fps: 0,
  lastFrame: null,
  hb: 0,
  lastHbAt: 0,
  obs: null,
  obsAt: 0,
  world: null,
  worldAt: 0,
  code: null,
  codeAt: 0,
  hellos: [],
};

let reqId = 0;
const waiting = new Map();

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), '[bridge]', ...a);
}

const EXPECTED_CAPS = {
  'filesystem.host_fs_visible': false,
  'filesystem.credentials_in_env': false,
  'network.listening_sockets': 0,
  'input.host_input': false,
  'output.state_channel': 'outbound',
};

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function validateCaps(caps) {
  if (!caps) return ['caps missing'];
  const bad = [];
  for (const [path, want] of Object.entries(EXPECTED_CAPS)) {
    const got = dig(caps, path);
    if (got !== want) bad.push(`${path}=${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
  return bad;
}

const server = net.createServer((sock) => {
  let role = null;
  const peerName = () => `${role}@${sock.remotePort}`;
  log('新连接', sock.remoteAddress + ':' + sock.remotePort);

  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { log('parse error len=' + line.length); continue; }
      if (!role && msg.t === 'hello') {
        role = msg.role || 'body';
        state[role] = sock;
        state.caps[role] = msg.caps || null;
        state.hellos.push({ role, at: Date.now(), pid: msg.pid });
        log(`hello role=${role}`, JSON.stringify(msg).slice(0, 200));
        const v = role === 'body' ? validateCaps(msg.caps) : [];
        if (v.length) log('CAPABILITY VIOLATION', v.join('; '));
        continue;
      }
      try { onMessage(msg, role); } catch (e) { log('handler error', e.message); }
    }
  });
  sock.on('close', () => {
    log('断开', peerName(), 'read=' + sock.bytesRead, 'write=' + sock.bytesWritten);
    if (role && state[role] === sock) state[role] = null;
  });
  sock.on('error', (e) => { log('socket error', peerName(), e.message); });
});

function onMessage(msg, role) {
  switch (msg.t) {
    case 'frame': {
      const now = Date.now();
      if (state.lastFrameAt) {
        const dt = (now - state.lastFrameAt) / 1000;
        state.fps = state.fps ? state.fps * 0.8 + (1 / dt) * 0.2 : 1 / dt;
      }
      state.lastFrameAt = now;
      state.frames += 1;
      state.lastFrame = Buffer.from(msg.b64 || '', 'base64');
      break;
    }
    case 'hb':
      state.hb += 1;
      state.lastHbAt = Date.now();
      break;
    case 'obs':
      state.obs = msg.data;
      state.obsAt = Date.now();
      break;
    case 'world':
      state.world = msg.data;
      state.worldAt = Date.now();
      break;
    case 'code':
      state.code = msg.data;
      state.codeAt = Date.now();
      break;
    case 'cdp': {
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); w(msg.res); }
      break;
    }
    case 'log':
      log('[sandbox] ' + (msg.msg || ''));
      break;
    default:
      break;
  }
}

function sendCdp(method, params = {}, session = null, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const sock = state.body;
    if (!sock) return resolve({ error: 'no body link' });
    const id = ++reqId;
    waiting.set(id, resolve);
    sock.write(JSON.stringify({ t: 'cdp', id, method, params, session }) + '\n');
    setTimeout(() => {
      if (waiting.has(id)) { waiting.delete(id); resolve({ error: 'timeout' }); }
    }, timeoutMs);
  });
}

const api = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      body: !!state.body,
      bot: !!state.bot,
      frames: state.frames,
      fps: Number(state.fps.toFixed(2)),
      lastFrameAgeMs: state.lastFrameAt ? Date.now() - state.lastFrameAt : null,
      hb: state.hb,
      obsAgeMs: state.obsAt ? Date.now() - state.obsAt : null,
      worldAgeMs: state.worldAt ? Date.now() - state.worldAt : null,
      caps: state.caps.body || null,
      capsViolations: state.body ? validateCaps(state.caps.body) : ['no body link'],
      hellos: state.hellos,
    }, null, 2));
    return;
  }

  if (url.pathname === '/obs') {
    res.writeHead(state.obs ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state.obs || { error: 'no obs' }, null, 2));
    return;
  }

  if (url.pathname === '/world') {
    res.writeHead(state.world ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state.world || { error: 'no world' }, null, 2));
    return;
  }

  if (url.pathname === '/code') {
    res.writeHead(state.code ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state.code || { error: 'no code state' }, null, 2));
    return;
  }

  if (url.pathname === '/cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch {}
      if (!state.bot) { res.writeHead(503); res.end('no bot link'); return; }
      state.bot.write(JSON.stringify({ t: 'cmd', verb: p.verb, args: p.args || {} }) + '\n');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, verb: p.verb }));
    });
    return;
  }

  if (url.pathname === '/frame') {
    if (!state.lastFrame) { res.writeHead(404); res.end('no frame'); return; }
    fs.writeFileSync(path.join(ART, 'latest.jpg'), state.lastFrame);
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(state.lastFrame);
    return;
  }

  if (url.pathname === '/nav' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch {}
      const r = await sendCdp('Page.navigate', { url: p.url || 'about:blank' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ target: p.url, r }));
    });
    return;
  }

  if (url.pathname === '/eval' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch {}
      const r = await sendCdp('Runtime.evaluate', {
        expression: p.expr || '1+1', returnByValue: true, awaitPromise: true,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r));
    });
    return;
  }

  if (url.pathname === '/click' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch {}
      const x = Number(p.x ?? 0), y = Number(p.y ?? 0);
      await sendCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sendCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      res.writeHead(200); res.end('ok');
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(LINK_PORT, '127.0.0.1', () => log(`等待 Worker 连接 127.0.0.1:${LINK_PORT}`));
api.listen(API_PORT, '127.0.0.1', () => log(`状态口 127.0.0.1:${API_PORT}`));
