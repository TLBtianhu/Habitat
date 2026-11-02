// 调 mcpfabric 的 HTTP RPC：node mcpfabric-call.mjs <method> <json-params>
import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
const method = process.argv[2];
const params = process.argv[3] ? JSON.parse(process.argv[3])
  : (method === 'join_world' ? { address: '127.0.0.1:25565' } : { worldId: 'mp:127.0.0.1:25565' });
const r = await fetch('http://127.0.0.1:25600/rpc', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
console.log(await r.text());
