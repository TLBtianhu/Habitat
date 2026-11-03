import assert from 'node:assert/strict';

const mode = process.argv[2] || 'running';
const get = async (url, optional = false) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
};
const base = 'http://127.0.0.1:';
if (mode === 'running') {
  const lifecycle = await get(base + '10240/lifecycle');
  assert.equal(lifecycle.state, 'running');
  assert.equal(lifecycle.recoveryRequired, false);
  await get(base + '10240/status');
  await get(base + '10260/status');
  await get(base + '10270/health');
  await get(base + '10271/health');
  await get(base + '10272/health');
  const live = await get(base + '10230/live/status');
  assert.equal(live.live, false);
  const qq = await get(base + '10240/qq/status');
  assert.equal(qq.state, 'disabled');
  console.log('ok: installed instance healthy on isolated ports, HLS off, external apps disabled');
} else {
  for (const path of ['10240/status', '10260/status', '10270/health', '10271/health', '10272/health']) {
    const value = await get(base + path, true);
    assert.equal(value, null, 'instance service still running: ' + path);
  }
  console.log('ok: installed instance services stopped');
}
const dev = await get(base + '9240/lifecycle', true);
if (dev) assert.equal(dev.state, 'running');
console.log('ok: development instance unchanged');
