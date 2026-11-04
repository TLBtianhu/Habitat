// owner-only 控制台预览：订阅 SceneRecorder 的同一份 FramePacket，不重新渲染。
import http from 'node:http';

export class ConsolePreviewOutput {
  constructor({ token, host = '127.0.0.1', port = 9281 }) {
    this.token = token;
    this.host = host;
    this.port = port;
    this.server = null;
    this.latest = null;
    this.state = 'stopped';
    this.frames = 0;
    this.lastError = null;
  }

  status() {
    return {
      state: this.state,
      url: this.server ? `http://${this.host}:${this.port}/preview/frame` : null,
      frames: this.frames,
      lastSeq: this.latest?.seq || null,
      lastPtsMs: this.latest?.ptsMs ?? null,
      lastError: this.lastError,
    };
  }

  authorized(req) {
    return !this.token || req.headers.authorization === `Bearer ${this.token}`;
  }

  async start() {
    if (this.server) return this.status();
    this.lastError = null;
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/preview/status') {
        if (!this.authorized(req)) { res.writeHead(403); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(this.status()));
        return;
      }
      if (url.pathname === '/preview/frame') {
        if (!this.authorized(req)) { res.writeHead(403); res.end(); return; }
        if (!this.latest) { res.writeHead(202, { 'cache-control': 'no-store' }); res.end(); return; }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-frame-seq': String(this.latest.seq), 'x-frame-at': String(this.latest.capturedAt), 'x-frame-pts': String(this.latest.ptsMs) });
        res.end(this.latest.data);
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.port = this.server.address().port;
    this.state = 'running';
    return this.status();
  }

  async push(packet) {
    if (this.state !== 'running') throw new Error('console preview is stopped');
    this.latest = packet;
    this.frames += 1;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.state = 'stopped';
    if (server) await new Promise((resolve) => server.close(resolve));
    return this.status();
  }
}
