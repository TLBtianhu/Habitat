// 用真实时间等待 HLS 播放后截图；--screenshot 的虚拟时间不适合验证视频。
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const chromePath = process.env.FB_CHROME || '/opt/habitat/runtime/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const out = process.env.SHOT_OUT || '/var/lib/habitat/artifacts/console-cdp.png';
const port = Number(process.env.SHOT_CDP_PORT || 9336);
const token = process.env.HABITAT_OWNER_TOKEN || fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();
const url = process.env.SHOT_URL || `http://127.0.0.1:9240/?token=${token}`;
const waitMs = Number(process.env.SHOT_WAIT_MS || 12000);
const profile = `/tmp/habitat-console-shot-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
      if (page) break;
    } catch {}
    await sleep(250);
  }
  if (!page) throw new Error('CDP not ready');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1000);
  if (process.env.SHOT_TAB) {
    const tab = JSON.stringify(process.env.SHOT_TAB);
    await send('Runtime.evaluate', { expression: `document.querySelector('[data-tab=' + ${tab} + ']')?.click()` });
    await sleep(500);
  }
  if (process.env.SHOT_DRAFT) {
    const draft = JSON.stringify(process.env.SHOT_DRAFT);
    await send('Runtime.evaluate', { expression: `(() => { const i = document.querySelector('#text'); if (i) i.value = ${draft}; })()` });
  }
  if (process.env.SHOT_AUDIO === '1') {
    const point = await send('Runtime.evaluate', {
      expression: `(() => { const r = document.querySelector('#audio').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const { x, y } = point.result.value;
    console.error('audio click', JSON.stringify(point.result.value));
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1000);
    const debug = await send('Runtime.evaluate', {
      expression: `({ state: document.querySelector('#state')?.textContent, enabled: typeof audioEnabled === 'undefined' ? null : audioEnabled, context: typeof audioCtx === 'undefined' ? null : audioCtx?.state || null, button: document.querySelector('#audio')?.textContent, atPoint: document.elementFromPoint(${x}, ${y})?.id })`,
      returnByValue: true,
    });
    console.error('audio debug', JSON.stringify(debug.result.value));
  }
  if (process.env.SHOT_VOICE_PROFILE) {
    const profile = JSON.stringify(process.env.SHOT_VOICE_PROFILE);
    await send('Runtime.evaluate', {
      expression: `(() => { const s = document.querySelector('#voice-profile'); s.value = ${profile}; s.dispatchEvent(new Event('change')); })()`,
    });
    await sleep(500);
  }
  if (process.env.SHOT_SAMPLE === '1') {
    const point = await send('Runtime.evaluate', {
      expression: `(() => { const r = document.querySelector('#sample').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const { x, y } = point.result.value;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  if (process.env.SHOT_MESSAGE) {
    const message = JSON.stringify(process.env.SHOT_MESSAGE);
    await send('Runtime.evaluate', {
      expression: `(async () => { await fetch('/system/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ text: ${message} }) }); })()`,
      awaitPromise: true,
    });
  }
  await sleep(waitMs);
  const info = await send('Runtime.evaluate', {
    expression: `(() => {
      const v = document.querySelector('video');
      return {
        liveText: document.querySelector('#nofeed')?.textContent,
        nofeedHidden: document.querySelector('#nofeed')?.hidden,
        video: v ? { readyState: v.readyState, currentTime: v.currentTime, paused: v.paused, error: v.error?.message || null, buffered: v.buffered.length ? [v.buffered.start(0), v.buffered.end(v.buffered.length - 1)] : null } : null,
        chat: {
          draft: document.querySelector('#text')?.value || null,
          messages: [...document.querySelectorAll('.msg')].map((el) => el.textContent),
        },
        audio: {
          enabled: typeof audioEnabled === 'undefined' ? null : audioEnabled,
          contextState: typeof audioCtx === 'undefined' ? null : audioCtx?.state || null,
          lastUtteranceId: typeof lastUtteranceId === 'undefined' ? null : lastUtteranceId,
          playing: typeof audioPlaying === 'undefined' ? null : audioPlaying,
          queued: typeof audioQueue === 'undefined' ? null : audioQueue.length,
          voiceProfile: document.querySelector('#voice-profile')?.value || null,
        },
      };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify(info.result.value));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(out);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
