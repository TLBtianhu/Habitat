// 舞台静态服务：127.0.0.1:9230
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.FB_STAGE_ROOT || 'C:/Habitat/stage';
const HLS_ROOT = process.env.FB_HLS_ROOT || path.join(ROOT, 'hls');
const PORT = Number(process.env.HABITAT_STAGE_PORT || 9230);
const LIVE_MAX_AGE_MS = Number(process.env.FB_LIVE_MAX_AGE_MS || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // 角色素材路由：/model/* -> whale-girl；/dafeiyu/* -> 大肥鱼
  if (url.pathname.startsWith('/model/') || url.pathname.startsWith('/dafeiyu/')) {
    const isWhale = url.pathname.startsWith('/model/');
    const rootDir = isWhale
      ? (process.env.FB_WHALE_ROOT || 'C:/Habitat/assets-packs/whale-girl/model')
      : (process.env.FB_DAFEIYU_ROOT || 'C:/Habitat/assets-packs/dafeiyu');
    const rel = url.pathname.slice(isWhale ? '/model/'.length : '/dafeiyu/'.length);
    const mf = path.join(rootDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(mf, (err, data) => {
      if (err) { res.writeHead(404); res.end('asset not found'); return; }
      const ext = path.extname(mf);
      const type = ext === '.json' ? 'application/json'
        : ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.jpg' ? 'image/jpeg'
        : ext === '.webm' ? 'video/webm'
        : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store',
        'access-control-allow-origin': '*' });
      res.end(data);
    });
    return;
  }
  if (url.pathname === '/live/status') {
    fs.stat(path.join(HLS_ROOT, 'live.m3u8'), (err, stat) => {
      const ageMs = err ? null : Math.max(0, Date.now() - stat.mtimeMs);
      const live = !err && stat.isFile() && ageMs <= LIVE_MAX_AGE_MS;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ live, ageMs, updatedAt: err ? null : stat.mtime.toISOString() }));
    });
    return;
  }
  // HLS 是 Outlet 的运行时产物，不从程序目录读旧文件。
  if (url.pathname === '/hls.min.js' || url.pathname.startsWith('/hls/')) {
    const p = url.pathname === '/hls.min.js' ? '/hls.min.js' : url.pathname.slice('/hls'.length);
    const root = url.pathname === '/hls.min.js' ? ROOT : HLS_ROOT;
    const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    });
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('stage on http://127.0.0.1:' + PORT));
