const r = await fetch('http://127.0.0.1:9237/identity/begin', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client: 'live', provider: 'bilibili' }),
});
const data = await r.json();
console.log(JSON.stringify(data, null, 2).slice(0, 500));
if (data.qrDataUrl) {
  const fs = await import('node:fs');
  fs.writeFileSync('/opt/habitat/src/artifacts/bilibili-qr.txt', data.qrDataUrl);
  fs.writeFileSync('/opt/habitat/src/artifacts/bilibili-binding.json', JSON.stringify({ bindingId: data.bindingId, qrcodeKey: data.qrcodeKey }));
}
