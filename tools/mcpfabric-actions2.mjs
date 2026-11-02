import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
for (const [method, params] of [
  ['chat.send', { message: 'hello from habitat' }],
  ['control.lookAt', { x: 0, y: 80, z: 0 }],
  ['player.getState', {}],
]) {
  const r = await fetch('http://127.0.0.1:25600/rpc', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  console.log(method, await r.text());
}
