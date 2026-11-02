// 用宿主 Chrome 把舞台渲染成视频（P2 端到端证明）
// Chrome headless → CDP screencast → ffmpeg(image2pipe) → mp4
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STAGE = process.argv[3] || 'http://127.0.0.1:9230/';
const DEBUG_PORT = 9333;
const OUT_DIR = 'C:/Habitat/artifacts';
const SECONDS = Number(process.argv[2] || 8);
const FPS = 20;

fs.mkdirSync(OUT_DIR, { recursive: true });
const mp4 = path.join(OUT_DIR, 'stage-test.mp4');
const jpg = path.join(OUT_DIR, 'stage-still.jpg');

const profile = path.join(OUT_DIR, 'chrome-profile');
fs.rmSync(profile, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('endpoint not ready: ' + url);
}

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', '-',
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x07090d',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', mp4,
], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.stdin.on('error', () => {});   // ffmpeg 先退出时吞掉 EPIPE

let ws, seq = 0, frames = 0, sent = 0, lastSent = 0, stillSaved = false;
const pending = new Map();

function send(method, params = {}, session = null) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const msg = { id, method, params };
    if (session) msg.sessionId = session;
    ws.send(JSON.stringify(msg));
  });
}

try {
  const list = await waitJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      console.log('[page]', m.params.type, txt);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('[page-error]', m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
    if (m.method === 'Page.screencastFrame') {
      frames++;
      const now = Date.now();
      // 关键：ack 必须带会话 id，否则 Chrome 三帧后停发
      ws.send(JSON.stringify({ id: ++seq, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId }, sessionId: m.sessionId }));
      if (now - lastSent >= 1000 / FPS - 2) {
        lastSent = now;
        sent++;
        ff.stdin.write(Buffer.from(m.params.data, 'base64'));
        if (!stillSaved && sent > FPS * 2) {
          fs.writeFileSync(jpg, Buffer.from(m.params.data, 'base64'));
          stillSaved = true;
        }
      }
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: STAGE });
  await sleep(1500);
  await send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });

  const t0 = Date.now();
  await sleep(SECONDS * 1000);
  const elapsed = (Date.now() - t0) / 1000;

  await send('Page.stopScreencast').catch(() => {});
  ws.close();
  chrome.kill();
  ff.stdin.end();

  await new Promise((r) => ff.on('close', r));
  const st = fs.statSync(mp4);
  console.log(JSON.stringify({
    seconds: elapsed,
    framesReceived: frames,
    framesEncoded: sent,
    encodeFps: Number((sent / elapsed).toFixed(1)),
    mp4: mp4,
    mp4KB: Math.round(st.size / 1024),
    still: stillSaved ? jpg : null,
  }, null, 2));
} catch (e) {
  console.error('FAIL', e.message);
  chrome.kill();
  try { ff.stdin.end(); } catch {}
  process.exitCode = 1;
}
