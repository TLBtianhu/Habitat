import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
const worldId = 'mp:ce70a970470837b6';
for (const method of ['player.getState', 'vision.describeScene']) {
  const r = await fetch('http://127.0.0.1:25600/rpc', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { worldId } }),
  });
  console.log(method, await r.text());
}
