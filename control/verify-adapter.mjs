const base = 'http://127.0.0.1:9250';
console.log('health', await (await fetch(base + '/health')).json());
console.log('connect', await (await fetch(base + '/danmaku/connect', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: 545068 }),
})).json());
await new Promise((r) => setTimeout(r, 7000));
const ev = await (await fetch(base + '/events')).json();
console.log('events', ev.length, 'danmaku', ev.filter((e) => e.type === 'danmaku').length);
console.log(ev.filter((e) => e.type === 'danmaku').slice(0, 3));
