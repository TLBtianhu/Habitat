// QQ Adapter：文字状态独立；屏幕画面通过 Desktop CaptureSession 获取。
// 注意：OneBot 没有标准屏幕共享传输，这里先提供真实桌面捕获与本地预览，不伪装成 QQ 视频已接通。
import http from 'node:http';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const DESKTOP = process.env.FB_DESKTOP_URL || 'http://127.0.0.1:9260';
const PORT = Number(process.env.HABITAT_QQ_PORT || 9251);
const OWNER_TOKEN = fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();
const events = [];
let capture = null;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16384) throw new Error('body too large');
  }
  return JSON.parse(text || '{}');
}
function isOwner(req) {
  return (req.headers.authorization || '') === `Bearer ${OWNER_TOKEN}`;
}
function requireOwner(req) {
  if (!isOwner(req)) {
    const e = new Error('owner required');
    e.code = 403;
    throw e;
  }
}
function publicCapture(c) {
  return {
    id: c.id,
    schemaVersion: c.schemaVersion,
    revision: c.revision,
    consumer: c.consumer,
    source: c.source,
    excludeSurfaces: c.excludeSurfaces,
    transport: c.transport,
    expiresAt: c.expiresAt,
  };
}
async function openCapture(options = {}) {
  if (capture) return { ...publicCapture(capture), already: true };
  const r = await fetch(`${DESKTOP}/capture/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OWNER_TOKEN}` },
    body: JSON.stringify({
      schemaVersion: 1,
      consumer: 'qq-screen-share',
      consumerApp: 'qq',
      source: options.source || { kind: 'display', id: 'main' },
      excludeSurfaces: options.excludeSurfaces || ['qq'],
      fps: Number(options.fps || 5),
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `desktop HTTP ${r.status}`);
  capture = { ...data, transport: 'preview-only' };
  return publicCapture(capture);
}
async function closeCapture() {
  if (!capture) return { alreadyStopped: true };
  const id = capture.id;
  const token = capture.captureToken;
  await fetch(`${DESKTOP}/capture/close`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ id }),
  }).catch(() => {});
  capture = null;
  return { closed: true, id };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      return json(res, 200, {
        name: manifest.name,
        version: manifest.version,
        status: 'ok',
        onebot: 'not-initialized',
        screenShare: capture ? publicCapture(capture) : null,
        note: '桌面捕获已接通；QQ 视频传输未接入',
      });
    }
    if (req.method === 'GET' && url.pathname === '/events') return json(res, 200, events.slice(-50));
    if (req.method === 'POST' && (url.pathname === '/capture/open' || url.pathname === '/screen-share/open')) {
      requireOwner(req);
      return json(res, 200, await openCapture(await body(req)));
    }
    if (req.method === 'POST' && (url.pathname === '/capture/close' || url.pathname === '/screen-share/close')) {
      requireOwner(req);
      return json(res, 200, await closeCapture());
    }
    if (req.method === 'GET' && (url.pathname === '/capture/frame' || url.pathname === '/screen-share/frame')) {
      requireOwner(req);
      if (!capture) return json(res, 404, { error: 'capture not open' });
      const upstream = await fetch(`${DESKTOP}/capture/frame?id=${encodeURIComponent(capture.id)}`, {
        cache: 'no-store', headers: { authorization: `Bearer ${capture.captureToken}` },
      });
      if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({ error: `desktop HTTP ${upstream.status}` }));
        return json(res, upstream.status, data);
      }
      res.writeHead(200, {
        'content-type': upstream.headers.get('content-type') || 'image/png',
        'cache-control': 'no-store',
        'x-frame-seq': upstream.headers.get('x-frame-seq') || '0',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, Number(e.code) || 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[qq-adapter] 127.0.0.1:${PORT} v${manifest.version}`));

function shutdown() {
  closeCapture().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
