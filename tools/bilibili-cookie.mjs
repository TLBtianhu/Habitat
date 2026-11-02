// 用无头浏览器完成 B站 crossDomain 登录并读取 SESSDATA（只输出该字段）
import { spawn } from 'node:child_process';

const url = process.argv[2];
if (!url) throw new Error('usage: bilibili-cookie.mjs <crossDomainUrl>');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/habitat-bili-login', '--remote-debugging-port=9333', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Page.enable');
await send('Network.enable');
await send('Network.setExtraHTTPHeaders', { headers: { Referer: 'https://passport.bilibili.com/login', Origin: 'https://passport.bilibili.com' } });
await send('Network.setCookie', { name: 'buvid3', value: 'habitat-demo', domain: '.bilibili.com' });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 4000));
const r = await send('Network.getCookies', { urls: ['https://www.bilibili.com', 'https://passport.biligame.com', 'https://passport.bilibili.com'] });
const cookies = r.result?.cookies || [];
console.log('cookies:', cookies.map((c) => `${c.name}@${c.domain}`).join(', '));
const sess = cookies.find((c) => c.name === 'SESSDATA');
const nav = await send('Runtime.evaluate', { expression: "fetch('https://api.bilibili.com/x/web-interface/nav').then(r=>r.json())", awaitPromise: true, returnByValue: true });
console.log('nav:', JSON.stringify(nav.result?.result?.value || nav.result));
console.log(JSON.stringify({ sessdata: sess ? sess.value : null }));
ws.close();
chrome.kill();
process.exit(0);
