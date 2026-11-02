import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DurableOutbox } from './durable-outbox.mjs';

const file = `/tmp/habitat-outbox-test-${process.pid}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { fs.rmSync(file, { force: true }); } catch {}
const counts = new Map();
const run = async (key, result = { ok: true }) => {
  counts.set(key, (counts.get(key) || 0) + 1);
  return result;
};

try {
  const outbox = new DurableOutbox({ file });
  await outbox.execute({ key: 'k1', verb: 'system.say', run: () => run('k1', { text: 'ok' }) });
  const duplicate = await outbox.execute({ key: 'k1', verb: 'system.say', run: () => run('k1', { text: 'bad' }) });
  assert.equal(duplicate.deduped, true);
  assert.equal(counts.get('k1'), 1, '成功 intent 不得重复执行');

  let release;
  const pending = outbox.execute({ key: 'k2', verb: 'system.say', run: () => new Promise((r) => { release = r; }) });
  await sleep(10);
  const inflight = await outbox.execute({ key: 'k2', verb: 'system.say', run: () => run('k2') });
  assert.equal(inflight.error, 'in_progress');
  release({ text: 'done' });
  await pending;

  await assert.rejects(() => outbox.execute({ key: 'k3', verb: 'system.say', run: async () => { throw new Error('bad'); } }), /bad/);
  const failed = await outbox.execute({ key: 'k3', verb: 'system.say', run: () => run('k3') });
  assert.equal(failed.deduped, true);
  assert.equal(failed.ok, false);

  const pendingRestart = outbox.execute({ key: 'k4', verb: 'system.say', run: () => new Promise(() => {}) });
  await sleep(10);
  const restarted = new DurableOutbox({ file });
  assert.equal(restarted.get('k4').state, 'interrupted');
  const interrupted = await restarted.execute({ key: 'k4', verb: 'system.say', run: () => run('k4') });
  assert.equal(interrupted.state, 'interrupted');
  void pendingRestart;

  const late = new DurableOutbox({ file });
  await assert.rejects(() => late.execute({
    key: 'k5', verb: 'system.say', timeoutMs: 10,
    run: async () => { await sleep(60); return { text: 'late' }; },
  }), /timeout/);
  await sleep(80);
  assert.equal(late.get('k5').state, 'succeeded');
  assert.equal(late.get('k5').late, true);
  const lateResult = await late.execute({ key: 'k5', verb: 'system.say', run: () => run('k5') });
  assert.equal(lateResult.deduped, true);
  assert.equal(lateResult.text, 'late');
  console.log('ok: 幂等、进行中拒重入、失败不复活、重启 interrupted、迟发结果补账');
} finally {
  try { fs.rmSync(file, { force: true }); } catch {}
}
