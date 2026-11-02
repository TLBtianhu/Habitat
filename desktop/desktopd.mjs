// desktopd：只暴露 AppSession 与它的投影。DSH 用 /apps，呈现侧用 /frame。
import http from 'node:http';
import { AppRegistry } from './app-registry.mjs';
import { compose } from './compositor.mjs';

const registry = new AppRegistry();
const inputs = new Map();
const PORT = Number(process.env.FB_DESKTOP_PORT || 9239);

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  const url = new URL(req.url, 'http://127.0.0.1');
  const read = () => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

  try {
    if (url.pathname === '/apps') { res.end(JSON.stringify({ current: registry.current(), apps: registry.list() }, null, 2)); return; }
    if (url.pathname === '/frame') { res.end(JSON.stringify(compose(registry, inputs), null, 2)); return; }

    if (url.pathname === '/app/open' && req.method === 'POST') {
      const { appId, meta } = await read();
      res.end(JSON.stringify(registry.open(appId, meta || {}))); return;
    }
    if (url.pathname === '/app/input' && req.method === 'POST') {
      const { appId, input } = await read();
      inputs.set(appId, input || {});
      res.end(JSON.stringify({ ok: true, appId })); return;
    }
    if (url.pathname === '/app/focus' && req.method === 'POST') {
      const { appId } = await read();
      res.end(JSON.stringify(registry.focus(appId))); return;
    }
    if (url.pathname === '/app/background' && req.method === 'POST') {
      const { appId } = await read();
      res.end(JSON.stringify(registry.background(appId))); return;
    }
    if (url.pathname === '/app/close' && req.method === 'POST') {
      const { appId } = await read();
      res.end(JSON.stringify(registry.close(appId))); return;
    }
    if (url.pathname === '/shutdown' && req.method === 'POST') {
      res.end('{}'); server.close(() => process.exit(0)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[desktop] 127.0.0.1:${PORT}`));
