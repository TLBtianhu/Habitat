const token = process.argv[2] || 'a0e5ff78e074';
const path = process.argv[3] || '/api/config';
const r = await fetch('http://127.0.0.1:6099' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accessToken: token }),
});
console.log(await r.text());
