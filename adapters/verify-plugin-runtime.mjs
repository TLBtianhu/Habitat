import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PluginRegistry } from './plugin-registry.mjs';
import { InstalledPluginSupervisor } from '../agent/installed-plugin-supervisor.mjs';

const root = `/tmp/habitat-plugin-runtime-test-${process.pid}`;
fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
fs.writeFileSync(path.join(root, 'demo', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  id: 'demo',
  kind: 'test',
  version: '1.0.0',
  lifecycle: 'provider',
  provider: 'provider.mjs',
  tools: [{ name: 'demo.ping', handler: 'ping', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
}));
fs.writeFileSync(path.join(root, 'demo', 'provider.mjs'), `
export function createRuntime() {
  const shared = globalThis.__habitatRuntimeTest;
  let state = 'stopped';
  return {
    async start() { shared.starts++; state = 'ready'; },
    async stop() { shared.stops++; state = 'stopped'; },
    status() { return { state }; },
  };
}
export function createHandlers({ runtime }) {
  return { ping: () => ({ state: runtime.status().state }) };
}
`);
globalThis.__habitatRuntimeTest = { starts: 0, stops: 0 };
const registry = PluginRegistry.fromDirectories([root], { outboxFile: `${root}/outbox.json` });
try {
  await registry.start('demo');
  assert.equal((await registry.call('demo.ping')).state, 'ready');
  await registry.suspend('demo');
  await assert.rejects(() => registry.call('demo.ping'), /suspended/);
  assert.equal(registry.runtime('demo').status().state, 'stopped');
  await registry.resume('demo');
  assert.equal((await registry.call('demo.ping')).state, 'ready');

  let items = [{ id: 'demo', enabled: true, revoked: false }];
  const supervisor = new InstalledPluginSupervisor({ installer: { installed: () => items }, registry });
  await supervisor.reconcile();
  items = [{ id: 'demo', enabled: false, revoked: false }];
  await supervisor.reconcile();
  assert.equal(registry.isSuspended('demo'), true);
  await assert.rejects(() => registry.call('demo.ping'), /suspended/);
  items = [{ id: 'demo', enabled: true, revoked: false }];
  await supervisor.reconcile();
  assert.equal(registry.isSuspended('demo'), false);
  assert.equal((await registry.call('demo.ping')).state, 'ready');
  items = [];
  await supervisor.reconcile();
  assert.equal(registry.isSuspended('demo'), true);
  await assert.rejects(() => registry.call('demo.ping'), /suspended/);

  const stopped = await registry.stopAll();
  assert.ok(stopped.every((item) => item.stopped !== false));
  assert.ok(globalThis.__habitatRuntimeTest.starts >= 3);
  assert.ok(globalThis.__habitatRuntimeTest.stops >= 3);
  console.log('ok: runtime 启停、停用/恢复/卸载即时生效、调用隔离与统一关停');
} finally {
  await registry.stopAll();
  delete globalThis.__habitatRuntimeTest;
  fs.rmSync(root, { recursive: true, force: true });
}
