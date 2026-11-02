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
await send('Network.enable');
const r = await send('Network.getAllCookies');
const cookies = r.result?.cookies || [];
const sess = cookies.find((c) => c.name === 'SESSDATA');
const cookieHeader = cookies.filter((c) => c.domain === '.bilibili.com').map((c) => `${c.name}=${c.value}`).join('; ');
fs.writeFileSync('C:/Habitat/artifacts/bilibili-cookies.txt', cookieHeader);
console.log('cookie header saved, len', cookieHeader.length);
console.log('cookie names:', cookies.map((c) => `${c.name}@${c.domain}`).join(', '));
if (!sess) { console.log(JSON.stringify({ sessdata: null })); process.exit(0); }
fs.writeFileSync('C:/Habitat/artifacts/bilibili-sessdata.txt', sess.value);
console.log(JSON.stringify({ sessdata: sess.value.slice(0, 8) + '...' }));
ws.close(); process.exit(0);
