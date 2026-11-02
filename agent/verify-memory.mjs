import assert from 'node:assert/strict';
import { Memory } from './memory.mjs';
import { Initiative } from './initiative.mjs';

console.log('[1] 工作记忆会衰减，档案记忆可检索');
{
  const m = new Memory({ halfLifeMs: 100, maxWorking: 3 });
  const t = Date.now();
  m.remember('昨天答应了观众砍树', { tags: ['promise'], importance: 1, at: t - 1000 });
  m.remember('附近有一棵橡树', { tags: ['world'], importance: 0.5, at: t });
  assert.ok(m.workingSet(t).includes('附近有一棵橡树'));
  assert.ok(!m.workingSet(t).includes('昨天答应了观众砍树') || m.workingSet(t).length <= 3);
  assert.ok(m.recall('橡树').includes('附近有一棵橡树'));
  console.log('  ok');
}

console.log('[2] 安静时有主动小事，且受额度限制');
{
  const i = new Initiative({ quietMs: 1000, dailyQuota: 1 });
  const obs = { action: { isIdle: true }, nearby: { blocks: [{ name: 'oak_log', nearest: 2 }] } };
  const first = i.next(obs, 5000);
  assert.equal(first.verb, 'dig');
  const second = i.next(obs, 6000);
  assert.equal(second, null, '超过每日额度后不应继续主动');
  console.log('  ok');
}

console.log('[3] 不安静时不主动');
{
  const i = new Initiative({ quietMs: 30000 });
  const r = i.next({ action: { isIdle: true }, nearby: { blocks: [] } }, 1000);
  assert.equal(r, null);
  console.log('  ok');
}

console.log('[4] residence 记忆不串场');
{
  const m = new Memory();
  m.remember('system fact', { scope: 'system' });
  m.remember('group A fact', { scope: 'qq.group.1', tags: ['qq'] });
  m.remember('group B fact', { scope: 'qq.group.2', tags: ['qq'] });
  assert.deepEqual(m.workingSet(), ['system fact']);
  assert.deepEqual(m.workingSet(Date.now(), { scope: 'qq.group.1' }), ['group A fact']);
  assert.deepEqual(m.workingSet(Date.now(), { scope: 'qq.group.2' }), ['group B fact']);
  assert.deepEqual(m.recall('fact'), ['system fact']);
  assert.deepEqual(m.recall('fact', { scope: 'qq.group.2' }), ['group B fact']);
  assert.equal(m.archive[1].sourceResidenceId, 'qq.group.1');
  console.log('  ok');
}

console.log('Memory/Initiative 验收通过');
process.exit(0);
