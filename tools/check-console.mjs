const r = await fetch('http://127.0.0.1:9230/console.html', { signal: AbortSignal.timeout(5000) });
console.log(r.status, (await r.text()).slice(0, 120));
