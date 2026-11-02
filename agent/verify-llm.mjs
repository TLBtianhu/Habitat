// LLM provider 验收：mock 输出 → JSON intent → broker；坏输出必须拒绝
import assert from 'node:assert/strict';
import { AgentLoop, createRuleBroker } from './agent-loop.mjs';
import { MockProvider, createLlmDecider } from './llm-provider.mjs';

console.log('[1] mock LLM 输出合法 intent');
{
  const provider = new MockProvider(['{"verb":"walk","args":{"toward":"oak_log","distance":3}}']);
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker, decider: createLlmDecider(provider) });
  const r = await loop.tick({ self: { health: 20 }, action: { isIdle: true }, nearby: { blocks: [] } });
  assert.equal(r.acted, true);
  assert.equal(r.intent.verb, 'walk');
  assert.equal(broker.calls[0].verb, 'walk');
  console.log('  ok');
}

console.log('[2] 非 JSON 输出拒绝');
{
  const provider = new MockProvider(['我随便说一句']);
  const loop = new AgentLoop({ broker: createRuleBroker(), decider: createLlmDecider(provider) });
  await assert.rejects(() => loop.tick({ self: { health: 20 }, action: { isIdle: true } }), /不是 JSON/);
  console.log('  ok');
}

console.log('[3] 非白名单动词拒绝');
{
  const provider = new MockProvider(['{"verb":"exec","args":{"cmd":"rm -rf /"}}']);
  const loop = new AgentLoop({ broker: createRuleBroker(), decider: createLlmDecider(provider) });
  await assert.rejects(() => loop.tick({ self: { health: 20 }, action: { isIdle: true } }), /白名单/);
  console.log('  ok');
}

console.log('[4] 规则脑仍兼容');
{
  const broker = createRuleBroker();
  const loop = new AgentLoop({ broker });
  const r = await loop.tick({ self: { health: 20 }, action: { isIdle: true }, nearby: { blocks: [{ name: 'stone', nearest: 1 }] } });
  assert.equal(r.acted, true);
  console.log('  ok');
}

console.log('LLM provider 验收通过');
process.exit(0);
