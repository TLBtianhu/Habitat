// 用 AgentLoop 驱动原生 MC 客户端：obs → intent → mcpfabric 动作
import { AgentLoop } from './agent-loop.mjs';
import { NativeMcClient } from '../clients/mc-native.mjs';
import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';

const client = new NativeMcClient({ token: loadMcpfabricToken() });
const broker = { call: (verb, args) => client.act({ verb, args }) };
const decider = (obs) => {
  if (obs.self.health < 8) return { verb: 'say', args: { text: '我先躲开一下，血量有点低。' } };
  const b = obs.nearby.blocks?.[0];
  if (b) return { verb: 'look', args: { x: obs.self.pos[0], y: obs.self.pos[1] + 2, z: obs.self.pos[2] + 3 } };
  return null;
};
const loop = new AgentLoop({ broker, decider });
const obs = await client.obs();
const r = await loop.tick(obs);
console.log(JSON.stringify(r, null, 2));
process.exit(0);
