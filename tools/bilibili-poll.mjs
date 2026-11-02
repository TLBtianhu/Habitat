const fs = await import('node:fs');
const b = JSON.parse(fs.readFileSync('/opt/habitat/src/artifacts/bilibili-binding.json', 'utf8'));
const r = await fetch('http://127.0.0.1:9237/identity/poll', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ bindingId: b.bindingId }),
});
console.log(await r.text());
