// P1 帧通路验证：宿主只通过中继拿帧，不碰 WSL 的显示
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:9223';
const OUT_DIR = 'C:/Habitat/artifacts';

const list = await (await fetch(BASE + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
let frames = 0;
let firstFrame = null;
let bytes = 0;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Page.screencastFrame') {
    frames += 1;
    bytes += msg.params.data.length;
    if (!firstFrame) firstFrame = msg.params.data;
    ws.send(
      JSON.stringify({
        id: ++seq,
        method: 'Page.screencastFrameAck',
        params: { sessionId: msg.params.sessionId },
      }),
    );
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');

const html = `<body style="margin:0;background:#0b0d12;overflow:hidden">
<div id="bg" style="position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#1b2740,#07090d)"></div>
<div id="box" style="position:absolute;top:280px;left:0;width:160px;height:160px;border-radius:24px;background:linear-gradient(135deg,#6ea8ff,#8b5cf6);box-shadow:0 0 60px #6ea8ff88"></div>
<div style="position:absolute;bottom:80px;width:100%;text-align:center;color:#cfd8ef;font:700 42px system-ui">sandbox body · frame proof</div>
<script>let x=0;const b=document.getElementById('box');setInterval(()=>{x=(x+6)%1120;b.style.transform='translateX('+x+'px)'},16)</script></body>`;

await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
await new Promise((r) => setTimeout(r, 600));
await send('Page.startScreencast', {
  format: 'jpeg',
  quality: 72,
  everyNthFrame: 1,
  maxWidth: 1280,
  maxHeight: 720,
});

const t0 = Date.now();
await new Promise((r) => setTimeout(r, 5000));
const elapsed = (Date.now() - t0) / 1000;

await send('Page.stopScreencast');
ws.close();

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, 'frame-proof.jpg');
if (firstFrame) fs.writeFileSync(file, Buffer.from(firstFrame, 'base64'));

console.log(JSON.stringify({
  frames,
  elapsedSec: Number(elapsed.toFixed(2)),
  fps: Number((frames / elapsed).toFixed(2)),
  avgKBPerFrame: frames ? Number((bytes / frames / 1024).toFixed(1)) : 0,
  saved: firstFrame ? file : null,
}, null, 2));
