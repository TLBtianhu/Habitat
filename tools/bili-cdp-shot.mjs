import fs from 'node:fs';
const list = await (await fetch('http://127.0.0.1:9335/json/list')).json();
const page = list.find((t) => t.type === 'page') || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
fs.writeFileSync('C:/Habitat/artifacts/bilibili-official-qr.png', Buffer.from(shot.result.data, 'base64'));
console.log('ok');
ws.close(); process.exit(0);
