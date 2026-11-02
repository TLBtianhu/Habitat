import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ResidenceMemoryStore } from './residence-memory-store.mjs';

const root = `/tmp/habitat-memory-store-test-${process.pid}`;
let now = 1000000000;
try {
  const first = new ResidenceMemoryStore({ root, now: () => now, residenceTtlMs: 1000 });
  const systemItem = first.remember('system fact', { scope: 'system', mode: 'persistent' });
  const secret = first.remember('Bearer abcdefgh ' + ['sk-', '12345678901234567890'].join(''), { scope: 'qq.group.1', mode: 'residence', tags: ['secret'] });
  assert.equal(first.remember('skip', { scope: 'qq.group.9', mode: 'ephemeral' }).skipped, true);
  assert.equal(fs.existsSync(first._file('qq.group.9')), false);
  assert.equal(secret.fact.includes('abcdefgh'), false);
  assert.equal(secret.fact.includes(['sk-', '12345678901234567890'].join('')), false);

  const restarted = new ResidenceMemoryStore({ root, now: () => now, residenceTtlMs: 1000 });
  assert.deepEqual(restarted.recall('system'), ['system fact']);
  assert.deepEqual(restarted.recall('secret', { scope: 'qq.group.1' }).length, 1);
  assert.deepEqual(restarted.recall('secret', { scope: 'qq.group.2' }), []);
  assert.deepEqual(restarted.recall('secret'), [], '默认 system 不读取群记忆');

  assert.throws(() => restarted.share({ factId: systemItem.id, targetResidenceId: 'qq.group.2', approvedBy: 'model' }), /owner approval/);
  const shared = restarted.share({ factId: systemItem.id, targetResidenceId: 'qq.group.2', approvedBy: 'owner' });
  assert.equal(shared.sharedFrom.scope, 'system');
  assert.deepEqual(restarted.recall('system', { scope: 'qq.group.2' }), ['system fact']);

  now += 1001;
  const expired = new ResidenceMemoryStore({ root, now: () => now, residenceTtlMs: 1000 });
  assert.deepEqual(expired.recall('secret', { scope: 'qq.group.1' }), []);
  assert.deepEqual(expired.recall('system'), ['system fact'], 'persistent 不受 residence TTL 影响');
  expired.compact();
  assert.equal(expired.list({ scope: 'qq.group.1' }).length, 0);
  console.log('ok: 持久化恢复、TTL、脱敏、residence 隔离与 owner-approved 共享');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
