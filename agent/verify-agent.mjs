// AgentLoop 验收：相位、限频、决策与 broker 闭集
import assert from 'node:assert/strict';
import { AgentLoop, createRuleBroker } from './agent-loop.mjs';

const obsWithTree = {
  self: { health: 20 },
  action: { isIdle: true },
  nearby: [{ name: 'oak_log', n: 4, nearest: 3.2 }],
};

console.log('[1] PLAY 下先 walk 后 dig');
{
  let t = 0;
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker, now: () => t });
  let r = await loop.tick(obsWithTree);
  assert.equal(r.acted, true);
  assert.equal(r.intent.verb, 'walk');
  t += 2000;
  r = await loop.tick(obsWithTree);
  assert.equal(r.acted, true);
  assert.equal(r.intent.verb, 'dig');
  console.log('  ok:', broker.calls.map((c) => c.verb).join(' → '));
}

console.log('[2] CODE 相位不碰世界');
{
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker, phase: 'CODE' });
  const r = await loop.tick(obsWithTree);
  assert.equal(r.acted, false);
  assert.equal(r.reason, 'wrong_phase');
  assert.equal(broker.calls.length, 0);
  console.log('  ok');
}

console.log('[3] 低血量优先说话');
{
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker });
  const r = await loop.tick({ self: { health: 4 }, action: { isIdle: true }, nearby: [] });
  assert.equal(r.intent.verb, 'say');
  console.log('  ok');
}

console.log('[4] 限频');
{
  let t = 0;
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker, now: () => t });
  await loop.tick(obsWithTree);
  const r = await loop.tick(obsWithTree);
  assert.equal(r.acted, false);
  assert.equal(r.reason, 'rate_limit');
  console.log('  ok');
}

console.log('AgentLoop 验收通过');
process.exit(0);
