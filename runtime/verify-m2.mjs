// M2 独立验收脚本：激活/拒绝/回滚/泄漏，逐条打印，避免 node:test 的输出缓冲
import assert from 'node:assert/strict';
import { SkillRuntime, makeArtifact } from './skill-runtime.mjs';

const good = (version, tag) => makeArtifact('chop-tree', version, `
module.exports = {
  manifest: { id: 'chop-tree', version: '${version}', entry: 'index.mjs', capabilities: ['mc.dig', 'chat.send', '__crash'] },
  async init(ctx) { ctx.ready = true; },
  async call(cap, args, ctx) {
    if (cap === 'mc.dig') return { dug: args.n || 1, by: '${tag}' };
    if (cap === 'chat.send') return { said: args.text || '' };
    throw new Error('unknown cap ' + cap);
  }
};
`, ['mc.dig', 'chat.send', '__crash']);

const bad = makeArtifact('chop-tree', '9.9.9', `throw new Error('bad artifact');`, ['mc.dig']);

console.log('[1] 激活与能力过滤');
{
  const rt = new SkillRuntime();
  await rt.activate(good('1.0.0', 'v1'));
  const r = await rt.call('chop-tree', 'mc.dig', { n: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { dug: 3, by: 'v1' });
  const denied = await rt.call('chop-tree', 'net.http', {});
  assert.equal(denied.ok, false);
  assert.ok(rt.commandLog.some((l) => l.type === 'capability_denied'));
  await rt.dispose();
  console.log('  ok');
}

console.log('[2] 坏 artifact 不切换');
{
  const rt = new SkillRuntime();
  await rt.activate(good('1.0.0', 'v1'));
  await assert.rejects(() => rt.activate(bad));
  const r = await rt.call('chop-tree', 'mc.dig', { n: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.value.by, 'v1');
  await rt.dispose();
  console.log('  ok');
}

console.log('[3] 观察窗口内崩溃自动回滚');
{
  const rt = new SkillRuntime({ watchMs: 10000 });
  await rt.activate(good('1.0.0', 'v1'));
  await rt.activate(good('1.1.0', 'v2'));
  await rt.call('chop-tree', '__crash');
  const end = Date.now() + 15000;
  let rolled = false;
  while (Date.now() < end) {
    if (rt.commandLog.some((l) => l.type === 'rollback')) { rolled = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(rolled, '必须有 rollback 记录');
  assert.equal(rt.generation.get('chop-tree'), 3);
  const r = await rt.call('chop-tree', 'mc.dig', { n: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.value.by, 'v1');
  await rt.dispose();
  console.log('  ok');
}

console.log('[4] 连续 30 代不泄漏');
{
  const rt = new SkillRuntime({ drainMs: 5 });
  for (let i = 0; i < 30; i++) await rt.activate(good(`1.${i}.0`, 'v' + i));
  assert.ok(rt.slots.size <= 2, `slots=${rt.slots.size}`);
  await rt.dispose();
  console.log('  ok, final slots=' + rt.slots.size);
}

console.log('M2 验收通过');
process.exit(0);
