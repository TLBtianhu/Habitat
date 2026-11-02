import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
const methods = ['player.getState', 'vision.describeScene', 'vision.screenshot', 'world.getTimeAndWeather'];
for (const method of methods) {
  const r = await fetch('http://127.0.0.1:25600/rpc', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
  });
  const text = await r.text();
  console.log(method, text.slice(0, 1200));
}
