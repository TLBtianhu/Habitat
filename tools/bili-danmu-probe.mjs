import fs from 'node:fs';
const list = await (await fetch('http://127.0.0.1:9335/json/list')).json();
const page = list.find((t) => t.type === 'page') || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const hits = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (u.includes('/getDanmuInfo')) hits.push({ url: u, headers: m.params.request.headers });
  }
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Network.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'https://live.bilibili.com/545068' });
await new Promise((r) => setTimeout(r, 10000));
fs.writeFileSync('C:/Habitat/artifacts/bili-danmu-probe.json', JSON.stringify(hits, null, 2));
console.log('hits', hits.length);
ws.close(); process.exit(0);
