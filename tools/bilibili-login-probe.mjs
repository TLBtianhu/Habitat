import { spawn } from 'node:child_process';
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=C:/Users/30680/AppData/Local/Temp/habitat-bili-probe', '--remote-debugging-port=9334', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const list = await (await fetch('http://127.0.0.1:9334/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const urls = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent') urls.push(m.params.request.url);
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'https://passport.bilibili.com/login' });
await new Promise((r) => setTimeout(r, 9000));
console.log('count', urls.length);
console.log(urls.join('\n'));
ws.close(); chrome.kill(); process.exit(0);
