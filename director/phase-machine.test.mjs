import test from 'node:test';
import assert from 'node:assert/strict';
import { PhaseMachine, Phase } from './phase-machine.mjs';

function fake({ hangDrain = false } = {}) {
  const calls = [];
  let t = 0;
  return {
    calls,
    world: {
      drain: () => { calls.push('drain'); return hangDrain ? new Promise(() => {}) : Promise.resolve(); },
      saveState: async () => { calls.push('save'); },
      park: async () => { calls.push('park'); },
      resume: async () => { calls.push('resume'); },
      cancelInflight: async () => { calls.push('cancel'); return { confirmed: true }; },
    },
    presenter: { setScene: async (s) => { calls.push('scene:' + s); } },
    recorder: { writeSession: async (s) => { calls.push('writeSession:' + s.done[0]); } },
    clock: () => ++t,
  };
}

test('BOOT → PLAY 后世界可写；进 CODE 后世界只读', async () => {
  const a = fake();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  assert.equal(m.canWriteWorld().ok, true);
  await m.to(Phase.CODE);
  assert.equal(m.canWriteWorld().ok, false);
  assert.equal(m.canWriteWorld().reason, 'wrong_phase');
  assert.deepEqual(a.calls.filter((c) => c === 'save' || c === 'park'), ['save', 'park']);
});

test('PLAY 与 CODE 不能共存（进 CODE 必须 quiesce + 存档 + 挂机）', async () => {
  const a = fake();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await m.to(Phase.CODE);
  assert.ok(a.calls.includes('drain'), '必须先 drain');
  assert.ok(a.calls.includes('save'), '必须存档');
  assert.ok(a.calls.includes('park'), '必须挂机');
  assert.ok(a.calls.includes('scene:code'));
  await m.to(Phase.PLAY);
  assert.ok(a.calls.includes('resume'));
});

test('quiesce 超时必取消在途命令', async () => {
  const a = fake({ hangDrain: true });
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await m.to(Phase.CODE);
  assert.ok(a.calls.includes('cancel'));
  assert.ok(m.log.some((r) => r.type === 'quiesce:cancelled'));
});

test('DEGRADED 恢复必须回到进入前相位', async () => {
  const a = fake();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await m.to(Phase.DEGRADED, 'chrome down');
  assert.equal(m.status.degraded, 'chrome down');
  await m.to(m.lastStablePhase);
  assert.equal(m.phase, Phase.PLAY);
  assert.equal(m.status.degraded, null);
});

test('ENDING 没有 session.json 不许走', async () => {
  const a = fake();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await assert.rejects(() => m.to(Phase.ENDING), /session\.json/);
  m.setHandoff({ done: ['盖好屋顶'], promises: [] });
  await m.to(Phase.ENDING);
  assert.ok(a.calls.some((c) => c.startsWith('writeSession')));
});

test('人工接管后 agent 一律被拒', async () => {
  const a = fake();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  m.setController('human');
  const r = m.canAct();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'human_control');
});

test('下播谓词：不许一开播就走、不许因为难而走', () => {
  const m = new PhaseMachine(fake());
  assert.equal(m.canEnd({ promisesCleared: true, goalDone: true, durationMin: 5 }), false);
  assert.equal(m.canEnd({ promisesCleared: true, goalDone: true, durationMin: 30, hardTask: true }), false);
  assert.equal(m.canEnd({ promisesCleared: true, goalDone: true, durationMin: 30 }), true);
  assert.equal(m.canEnd({ promisesCleared: true, goalDone: false, durationMin: 30, idleDensity: 0.5 }), false);
});

function faulty() {
  const state = { calls: [], fail: new Set(), scene: 'standby', cancelResult: undefined };
  const call = (name) => {
    state.calls.push(name);
    if (state.fail.has(name)) throw new Error(name + ' failed');
  };
  return {
    state,
    calls: state.calls,
    world: {
      drain: () => { state.calls.push('drain'); return Promise.resolve(); },
      saveState: () => call('saveState'),
      park: () => call('park'),
      resume: () => call('resume'),
      cancelInflight: () => { state.calls.push('cancel'); return state.cancelResult; },
    },
    presenter: {
      setScene: (scene) => {
        call('scene:' + scene);
        state.scene = scene;
      },
    },
    recorder: { writeSession: () => call('writeSession') },
  };
}

test('非法转换在副作用前被拒绝', async () => {
  const a = faulty();
  const m = new PhaseMachine(a);
  await assert.rejects(() => m.to(Phase.CODE), /illegal transition/);
  assert.equal(m.phase, Phase.BOOT);
  assert.equal(a.calls.length, 0);
  assert.ok(m.log.some((r) => r.type === 'phase:reject'));
});

test('每次转换和外部副作用都有同一 transitionId，并可从快照重建', async () => {
  const a = faulty();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await m.to(Phase.CODE);
  const ids = m.log.filter((r) => r.type === 'phase').map((r) => r.transitionId);
  assert.deepEqual(ids, [1, 2]);
  const effects = m.snapshot().effects;
  assert.ok(effects.length > 0);
  assert.ok(effects.every((e) => e.transitionId === 2));
  assert.ok(effects.some((e) => e.action === 'park' && e.outcome === 'confirmed'));
});

test('saveState 失败：不 park、不换场景、不误报 CODE', async () => {
  const a = faulty();
  a.state.fail.add('saveState');
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await assert.rejects(() => m.to(Phase.CODE), /saveState failed/);
  assert.equal(m.phase, Phase.PLAY);
  assert.equal(a.calls.includes('park'), false);
  assert.equal(a.calls.includes('scene:code'), false);
  assert.equal(m.pendingReconciliation.length, 0);
  assert.ok(m.log.some((r) => r.type === 'phase:abort'));
});

test('scene 失败：park 已发生则逆序补偿 resume', async () => {
  const a = faulty();
  a.state.fail.add('scene:code');
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await assert.rejects(() => m.to(Phase.CODE), /scene:code failed/);
  assert.equal(m.phase, Phase.PLAY);
  assert.deepEqual(a.calls.filter((c) => ['park', 'resume', 'scene:code'].includes(c)), ['park', 'scene:code', 'resume']);
  assert.equal(m.pendingReconciliation.length, 0);
  assert.equal(m.canAct().ok, true);
});

test('补偿失败进入可对账状态；禁止新转换，reconcile 后恢复', async () => {
  const a = faulty();
  a.state.fail.add('scene:code');
  a.state.fail.add('resume');
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await assert.rejects(() => m.to(Phase.CODE), /scene:code failed/);
  assert.equal(m.phase, Phase.PLAY);
  assert.equal(m.pendingReconciliation.length, 1);
  assert.equal(m.canAct().reason, 'reconciliation_required');
  await assert.rejects(() => m.to(Phase.VERIFY), /reconciliation required/);
  a.state.fail.delete('resume');
  assert.equal(await m.reconcile(), true);
  assert.equal(m.pendingReconciliation.length, 0);
  assert.equal(m.canAct().ok, true);
  assert.ok(m.log.some((r) => r.type === 'reconcile:done'));
});

test('quiesce 超时且取消未明确确认：不得声称 quiesce:done', async () => {
  const a = faulty();
  a.world.drain = () => new Promise(() => {});
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await assert.rejects(() => m.quiesce(5), /cancel_unconfirmed/);
  assert.equal(m.log.some((r) => r.type === 'quiesce:done'), false);
  assert.equal(m.phase, Phase.PLAY);
});

test('离开 CODE 的 scene 失败：补偿回 park 和原场景', async () => {
  const a = faulty();
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  await m.to(Phase.CODE);
  a.state.fail.add('scene:world');
  await assert.rejects(() => m.to(Phase.PLAY), /scene:world failed/);
  assert.equal(m.phase, Phase.CODE);
  assert.ok(a.calls.includes('park'), '必须补偿回 park');
  assert.ok(a.calls.filter((c) => c === 'scene:code').length >= 2, '必须补偿回原场景');
  assert.equal(m.pendingReconciliation.length, 0);
});

test('recorder 失败：不进入 ENDING、不显示结束场景', async () => {
  const a = faulty();
  a.state.fail.add('writeSession');
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  m.setHandoff({ done: ['x'], promises: [] });
  await assert.rejects(() => m.to(Phase.ENDING), /writeSession failed/);
  assert.equal(m.phase, Phase.PLAY);
  assert.equal(a.calls.includes('scene:ending'), false);
});

test('转换执行期间 canAct 拒绝新动作', async () => {
  const a = faulty();
  let release;
  a.world.saveState = () => { a.calls.push('saveState'); return new Promise((r) => { release = r; }); };
  const m = new PhaseMachine(a);
  await m.to(Phase.PLAY);
  const transitioning = m.to(Phase.CODE);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(m.canAct().reason, 'transition_in_progress');
  release();
  await transitioning;
  assert.equal(m.canAct().ok, true);
});
