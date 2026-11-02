const r = await fetch('http://127.0.0.1:9240/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ from: 'viewer', text: '本地直播间已接通' }),
});
console.log(await r.text());
