// Habitat Desktop Compositor 服务：语义状态与像素捕获分离。
import http from 'node:http';
import fs from 'node:fs';
import { AppRegistry } from './app-registry.mjs';
import { CompositorRuntime } from './compositor-runtime.mjs';
import { FileSurfaceProvider } from './surface-provider.mjs';
import { renderSvg } from './renderer.mjs';
import { Resvg } from '@resvg/resvg-js';

const PORT = Number(process.env.HABITAT_DESKTOP_PORT || 9260);
const AGENT_TOKEN = fs.readFileSync('/etc/habitat/agent.token', 'utf8').trim();
const OWNER_TOKEN = fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();
const registry = new AppRegistry();
const providers = new Map([
  ['mc', new FileSurfaceProvider({
    appId: 'mc',
    framePath: process.env.FB_MC_FRAME || '/var/lib/habitat/artifacts/mc-pixels.jpg',
  })],
]);
const runtime = new CompositorRuntime({
  registry,
  providers,
  render: (plan) => {
    const svg = renderSvg(plan);
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1280 } });
    return { data: resvg.render().asPng(), mime: 'image/png' };
  },
  logger: (...args) => console.log(new Date().toISOString(), '[desktop]', ...args),
});
runtime.refreshSessions();

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
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer /, '');
}
function isAgent(req) { return bearer(req) === AGENT_TOKEN; }
function isOwner(req) { return bearer(req) === OWNER_TOKEN; }
function requireAgent(req) {
  if (!isAgent(req) && !isOwner(req)) {
    const e = new Error('agent or owner token required');
    e.code = 403;
    throw e;
  }
}
function validateOpen(p) {
  const allowed = new Set(['schemaVersion', 'consumer', 'consumerApp', 'source', 'excludeSurfaces', 'fps']);
  for (const key of Object.keys(p)) {
    if (!allowed.has(key)) {
      const e = new Error('unknown capture field: ' + key);
      e.code = 400;
      throw e;
    }
  }
  if (p.schemaVersion != null && p.schemaVersion !== 1) {
    const e = new Error('unsupported capture schemaVersion');
    e.code = 400;
    throw e;
  }
  const idPattern = /^[a-z0-9._:-]{1,64}$/i;
  if (!idPattern.test(String(p.consumer || ''))) {
    const e = new Error('consumer id required');
    e.code = 400;
    throw e;
  }
  if (p.consumerApp != null && !idPattern.test(String(p.consumerApp))) {
    const e = new Error('invalid consumerApp');
    e.code = 400;
    throw e;
  }
  if (p.excludeSurfaces != null && (!Array.isArray(p.excludeSurfaces) || p.excludeSurfaces.length > 64
    || p.excludeSurfaces.some((id) => !idPattern.test(String(id))))) {
    const e = new Error('invalid excludeSurfaces');
    e.code = 400;
    throw e;
  }
  return p;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      runtime.refreshSessions();
      return json(res, 200, runtime.describe());
    }
    if (req.method === 'GET' && url.pathname === '/captures') {
      return json(res, 200, runtime.listCaptures());
    }
    if (req.method === 'POST' && url.pathname === '/capture/open') {
      requireAgent(req);
      return json(res, 200, await runtime.openCapture(validateOpen(await body(req))));
    }
    if (req.method === 'POST' && url.pathname === '/capture/close') {
      const { id } = await body(req);
      const capture = runtime.getCapture(id);
      const token = isOwner(req) ? capture.captureToken : bearer(req);
      return json(res, 200, await runtime.closeCapture(id, token));
    }
    if (req.method === 'GET' && url.pathname === '/capture/frame') {
      const id = url.searchParams.get('id');
      const frame = runtime.getCaptureFrame(id, bearer(req));
      const capture = runtime.getCapture(id);
      res.writeHead(200, {
        'content-type': frame.mime,
        'cache-control': 'no-store',
        'x-frame-seq': String(frame.seq),
        'x-frame-at': String(frame.at),
        'x-capture-schema': '1',
        'x-capture-revision': String(capture.revision),
        'x-capture-expires-at': String(capture.lastReadAt + runtime.captureTtlMs),
      });
      res.end(frame.data);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    const code = Number(e.code) || 500;
    json(res, code, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[desktop] 127.0.0.1:${PORT}`));

function shutdown() {
  runtime.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
