import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
for (const [method, params] of [
  ['chat.send', { text: 'hello from habitat' }],
  ['control.lookAt', { yaw: 0, pitch: 0 }],
  ['screen.get', {}],
]) {
  const r = await fetch('http://127.0.0.1:25600/rpc', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  console.log(method, await r.text());
}
