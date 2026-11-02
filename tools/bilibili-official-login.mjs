// 打开官方 B站登录页，截取官方二维码；Chrome 保持运行，供后续读取 cookie
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=C:/Users/30680/AppData/Local/Temp/habitat-bili-official',
  '--remote-debugging-port=9335', 'about:blank',
], { stdio: 'ignore', detached: true });
chrome.unref();
await new Promise((r) => setTimeout(r, 3000));
const list = await (await fetch('http://127.0.0.1:9335/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Page.navigate', { url: 'https://passport.bilibili.com/login' });
await new Promise((r) => setTimeout(r, 7000));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('C:/Habitat/artifacts/bilibili-official-login.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot written');
ws.close();
process.exit(0);
