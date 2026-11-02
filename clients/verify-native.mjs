import assert from 'node:assert/strict';
import { NativeMcClient } from './mc-native.mjs';
import { loadMcpfabricToken } from './mcpfabric-token.mjs';

const c = new NativeMcClient({ token: loadMcpfabricToken() });
const info = await c.info();
assert.equal(info.player, 'DafeiyuNative4');
const obs = await c.obs();
assert.equal(obs.mode, 'play');
assert.ok(Array.isArray(obs.self.pos));
console.log('obs:', JSON.stringify(obs).slice(0, 300));
const look = await c.lookAt(obs.self.pos[0], obs.self.pos[1] + 2, obs.self.pos[2] + 3);
assert.ok(typeof look.yaw === 'number');
const chat = await c.chat('native client online');
assert.equal(chat.sent, true);
console.log('Native MC client 验收通过');
process.exit(0);
