import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistry } from './plugin-registry.mjs';
import { AppSessionManager } from '../agent/app-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = { adapter: [], outlet: [], mc: [], chat: [], voice: [] };
const outboxFile = `/tmp/habitat-plugin-outbox-${process.pid}.json`;
const extendedOutboxFile = `/tmp/habitat-plugin-outbox-extended-${process.pid}.json`;
const client = {
  obs: async () => ({ mode: 'play' }),
  act: async ({ verb, args }) => { calls.mc.push({ verb, args }); return { ok: true, verb, args }; },
};
const systemChat = { say: async (text) => { calls.chat.push(text); return { id: calls.chat.length, text }; } };
const voice = { speak: async (args) => { calls.voice.push(args); return { id: 10, ...args }; } };
const registry = PluginRegistry.fromDirectories([
  path.join(root, 'adapters'),
  path.join(root, 'plugins'),
], {
  adapterHost: { start: (id) => calls.adapter.push(['start', id]), stop: (id) => calls.adapter.push(['stop', id]) },
  outletHost: { start: async (id) => { calls.outlet.push(['start', id]); return { accepted: true }; }, stop: async (id) => { calls.outlet.push(['stop', id]); return { stopped: true }; } },
  providerContext: { client, systemChat, voice },
  outboxFile,
});

const session = new AppSessionManager();
registry.openSessions(session);
const apps = session.obs();
for (const id of ['desktop', 'voice.library', 'mc', 'qq', 'bilibili', 'hls']) assert.ok(apps[id], `missing ${id}`);
assert.equal(apps.mc.state, 'focused');
assert.equal(apps['system.chat'], undefined, 'system.chat 不应伪装成普通 AppSession');
assert.deepEqual(registry.toolNames().sort(), ['mc.obs', 'mc.look', 'mc.say', 'mc.stop', 'qq.reply', 'system.say', 'voice.speak'].sort());
assert.deepEqual(registry.listTools().map((t) => t.name), registry.toolNames(), 'MCP schema 与 Registry 必须一致');

assert.equal((await registry.call('system.say', { text: 'hello' })).text, 'hello');
assert.equal((await registry.call('mc.obs')).mode, 'play');
assert.equal((await registry.call('mc.say', { text: 'game' })).verb, 'mc.say');
const spoken = await registry.call('voice.speak', { text: 'voice', voiceProfile: 'generic/kokoro-zf-xiaoni' });
assert.equal(spoken.message.text, 'voice');
assert.equal(spoken.utterance.voiceProfile, 'generic/kokoro-zf-xiaoni');
await assert.rejects(() => registry.call('system.say', { text: 123 }), /must be string/);
await assert.rejects(() => registry.call('system.say', { text: 'x', extra: true }), /unknown arg/);
await assert.rejects(() => registry.call('missing.tool', {}), /unknown tool/);

await registry.start('hls');
await registry.stop('hls');
await registry.start('bilibili');
await registry.stop('bilibili');
await registry.start('qq');
await registry.stop('qq');
assert.deepEqual(calls.outlet.map((x) => x[0]), ['start', 'stop']);
assert.deepEqual(calls.adapter.map((x) => x[0]), ['start', 'stop']);

const first = await registry.call('system.say', { text: 'once', idempotencyKey: 'key-1' });
const second = await registry.call('system.say', { text: 'once', idempotencyKey: 'key-1' });
assert.equal(second.deduped, true);
assert.equal(calls.chat.filter((x) => x === 'once').length, 1, '幂等键不得重复执行');

// 新增插件只增加 manifest/provider，不修改 AgentLoop。
const temp = `/tmp/habitat-plugin-test-${process.pid}`;
fs.mkdirSync(path.join(temp, 'demo'), { recursive: true });
const manifest = {
  schemaVersion: 1, id: 'demo', kind: 'demo', version: '1.0.0', lifecycle: 'declarative', provider: 'provider.mjs',
  tools: [{ name: 'demo.ping', handler: 'ping', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
};
fs.writeFileSync(path.join(temp, 'demo', 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(temp, 'demo', 'provider.mjs'), 'export function createHandlers(){ return { ping: () => ({ pong: true }) }; }');
const extended = PluginRegistry.fromDirectories([path.join(root, 'adapters'), path.join(root, 'plugins'), temp], { providerContext: { client, systemChat, voice }, outboxFile: extendedOutboxFile });
assert.deepEqual((await extended.call('demo.ping', {})).pong, true);
fs.rmSync(temp, { recursive: true, force: true });
fs.rmSync(outboxFile, { force: true });
fs.rmSync(extendedOutboxFile, { force: true });
console.log('ok: manifest 驱动 AppSession、工具分发、生命周期、幂等与新增插件');
