import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillRuntime, makeArtifact } from './skill-runtime.mjs';

const good = (version, tag) => makeArtifact('chop-tree', version, `
module.exports = {
  manifest: { id: 'chop-tree', version: '${version}', entry: 'index.mjs', capabilities: ['mc.dig', 'chat.send'] },
  async init(ctx) { ctx.ready = true; },
  async call(cap, args, ctx) {
    if (cap === 'mc.dig') return { dug: args.n || 1, by: '${tag}' };
    if (cap === 'chat.send') return { said: args.text || '' };
    throw new Error('unknown cap ' + cap);
  }
};
`, ['mc.dig', 'chat.send', '__crash']);

const bad = makeArtifact('chop-tree', '9.9.9', `throw new Error('bad artifact');`, ['mc.dig']);

test('激活 + 能力调用 + 未声明能力拒绝', async () => {
  const rt = new SkillRuntime();
  await rt.activate(good('1.0.0', 'v1'));
  const r = await rt.call('chop-tree', 'mc.dig', { n: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { dug: 3, by: 'v1' });
  const denied = await rt.call('chop-tree', 'net.http', {});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /capability_denied/);
  assert.ok(rt.commandLog.some((l) => l.type === 'capability_denied'));
  await rt.dispose();
});

test('坏 artifact 不切换：旧槽继续可用', async () => {
  const rt = new SkillRuntime();
  await rt.activate(good('1.0.0', 'v1'));
  await assert.rejects(() => rt.activate(bad));
  const r = await rt.call('chop-tree', 'mc.dig', { n: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.value.by, 'v1');
  await rt.dispose();
});

test('新槽在观察窗口内崩溃 → 自动回滚，id 不变，代数前进', async () => {
  const rt = new SkillRuntime({ watchMs: 400 });
  await rt.activate(good('1.0.0', 'v1'));
  await rt.activate(good('1.1.0', 'v2'));
  assert.equal(rt.generation.get('chop-tree'), 2);

  await rt.call('chop-tree', '__crash');            // 让 v2 的 worker 死掉
  await new Promise((r) => setTimeout(r, 600));      // 等观察窗口触发回滚

  assert.ok(rt.commandLog.some((l) => l.type === 'rollback'), '必须有 rollback 记录');
  assert.equal(rt.generation.get('chop-tree'), 3, '回滚也算一代');
  const r = await rt.call('chop-tree', 'mc.dig', { n: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.value.by, 'v1', '回滚后仍是同一个 id 的旧实现');
  await rt.dispose();
});

test('连续 30 代激活不泄漏 worker / 槽', async () => {
  const rt = new SkillRuntime({ drainMs: 5 });
  for (let i = 0; i < 30; i++) {
    await rt.activate(good(`1.${i}.0`, 'v' + i));
  }
  assert.ok(rt.slots.size <= 2, `槽应被回收，实际 ${rt.slots.size}`);
  const r = await rt.call('chop-tree', 'mc.dig', { n: 1 });
  assert.equal(r.ok, true);
  await rt.dispose();
});

function tenant(id, version, { initDelay = 0, callDelay = 0 } = {}) {
  return makeArtifact(id, version, `
    module.exports = {
      manifest: { id: '${id}', version: '${version}', entry: 'index.mjs', capabilities: ['ping', 'slow', '__crash'] },
      async init(ctx) { ${initDelay ? `await new Promise(r => setTimeout(r, ${initDelay}));` : ''} },
      async call(cap, args, ctx) {
        if (cap === 'ping') return { id: '${id}', version: '${version}' };
        if (cap === 'slow') { await new Promise(r => setTimeout(r, ${callDelay || 150})); return { id: '${id}', version: '${version}' }; }
        throw new Error('unknown cap ' + cap);
      }
    };
  `, ['ping', 'slow', '__crash']);
}

test('多租户：激活与回滚 A 不影响 B/C 的活槽', async () => {
  const rt = new SkillRuntime({ drainMs: 5 });
  await rt.activate(tenant('a', '1.0.0'));
  await rt.activate(tenant('b', '1.0.0'));
  await rt.activate(tenant('c', '1.0.0'));
  await rt.activate(tenant('a', '2.0.0'));
  assert.equal((await rt.call('a', 'ping')).value.version, '2.0.0');
  assert.equal((await rt.call('b', 'ping')).value.version, '1.0.0');
  assert.equal((await rt.call('c', 'ping')).value.version, '1.0.0');
  await rt.rollback('a', 'test');
  assert.equal((await rt.call('a', 'ping')).value.version, '1.0.0');
  assert.equal((await rt.call('b', 'ping')).value.version, '1.0.0');
  assert.equal((await rt.call('c', 'ping')).value.version, '1.0.0');
  assert.equal(rt.slots.size, 3);
  await rt.dispose();
});

test('超时调用移除 pending；迟发结果只记事件且不增加 message 监听器', async () => {
  const rt = new SkillRuntime({ callTimeoutMs: 30, drainMs: 5 });
  await rt.activate(tenant('slow', '1.0.0', { callDelay: 100 }));
  const slot = rt.slots.get(rt.live.get('slow'));
  const baseline = slot.worker.listenerCount('message');
  for (let i = 0; i < 12; i++) {
    const r = await rt.call('slow', 'slow');
    assert.equal(r.error, 'timeout');
  }
  assert.equal(slot.pending.size, 0);
  assert.equal(slot.worker.listenerCount('message'), baseline);
  await new Promise((r) => setTimeout(r, 180));
  assert.ok(rt.commandLog.filter((l) => l.type === 'call:late').length >= 1);
  assert.equal(rt.live.get('slow'), slot.key);
  await rt.dispose();
});

test('同一技能并发激活按请求顺序完成，旧代不能覆盖新代', async () => {
  const rt = new SkillRuntime({ drainMs: 5 });
  const first = rt.activate(tenant('ordered', '1.0.0', { initDelay: 80 }));
  const second = rt.activate(tenant('ordered', '2.0.0'));
  await Promise.all([first, second]);
  assert.equal(rt.generation.get('ordered'), 2);
  assert.equal((await rt.call('ordered', 'ping')).value.version, '2.0.0');
  await rt.dispose();
});

test('转换期间旧槽崩溃不触发旧代回滚覆盖新激活', async () => {
  const rt = new SkillRuntime({ drainMs: 5 });
  await rt.activate(tenant('race', '1.0.0'));
  const activating = rt.activate(tenant('race', '2.0.0', { initDelay: 80 }));
  await rt.call('race', '__crash');
  await activating;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await rt.call('race', 'ping')).value.version, '2.0.0');
  assert.equal(rt.commandLog.some((l) => l.type === 'rollback'), false);
  assert.ok(rt.commandLog.some((l) => l.type === 'unhealthy:ignored_transition'));
  await rt.dispose();
});

test('drain 结算挂起调用，迟发结果不会写入新槽', async () => {
  const rt = new SkillRuntime({ callTimeoutMs: 300, drainMs: 5 });
  await rt.activate(tenant('drain-call', '1.0.0', { callDelay: 120 }));
  const pending = rt.call('drain-call', 'slow');
  const activating = rt.activate(tenant('drain-call', '2.0.0'));
  assert.equal((await pending).ok, false);
  await activating;
  assert.equal((await rt.call('drain-call', 'ping')).value.version, '2.0.0');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(rt.commandLog.some((l) => l.type === 'call' && l.capability === 'slow' && l.ok), false);
  await rt.dispose();
});

test('init 超时不切换，旧槽继续可用且不残留初始化监听器', async () => {
  const rt = new SkillRuntime({ callTimeoutMs: 30, drainMs: 5 });
  await rt.activate(tenant('chop-tree', '1.0.0'));
  const oldSlot = rt.slots.get(rt.live.get('chop-tree'));
  const baseline = oldSlot.worker.listenerCount('message');
  await assert.rejects(() => rt.activate(tenant('chop-tree', '2.0.0', { initDelay: 200 })), /init timeout/);
  assert.equal((await rt.call('chop-tree', 'ping')).value.version, '1.0.0');
  assert.equal(rt.slots.size, 1);
  assert.equal(oldSlot.worker.listenerCount('message'), baseline);
  assert.ok(rt.commandLog.some((l) => l.type === 'activate:reject' && l.error === 'init timeout'));
  await rt.dispose();
});

