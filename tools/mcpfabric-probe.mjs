import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const token = loadMcpfabricToken();
const methods = ['client.self', 'client.observation', 'world.observation', 'mc.obs', 'player.self', 'player.observation', 'client.screenshot', 'world.screenshot', 'session.worlds'];
for (const method of methods) {
  try {
    const r = await fetch('http://127.0.0.1:25600/rpc', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
    });
    console.log(method, await r.text());
  } catch (e) { console.log(method, 'ERR', e.message); }
}
