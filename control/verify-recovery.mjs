import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RecoveryManager } from './recovery.mjs';
import { EpisodeStore } from '../agent/episode-store.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';
import { SkillLibrary } from '../agent/skill-library.mjs';

const root = `/tmp/habitat-recovery-test-${process.pid}`;
const file = `${root}/lifecycle.json`;
const episodeStore = new EpisodeStore({ root: `${root}/episodes` });
const afterAction = new AfterActionStore({ file: `${root}/after.jsonl` });
const skillLibrary = new SkillLibrary({ file: `${root}/skills.json` });
const manager = new RecoveryManager({ file, episodeStore, afterAction, skillLibrary });
try {
  assert.equal(manager.boot().lastShutdownAbnormal, false);
  assert.equal(manager.ready().state, 'running');
  manager.stopping();
  manager.stopped();
  assert.equal(manager.boot().lastShutdownAbnormal, false);
  manager.stopping();
  const abnormal = manager.boot();
  assert.equal(abnormal.lastShutdownAbnormal, true, '未正常停止必须标为异常');

  const episode = episodeStore.get(process.env.HABITAT_EPISODE_ID || 'live-current') || episodeStore.create({ id: 'live-current', goal: 'recovery', participants: ['system'] });
  const write = episode.addPendingWrite('demo.action', { args: {}, residenceId: 'system' });
  episodeStore.save(episode);
  afterAction.record({ taskId: write.id, residenceId: 'system', goal: 'demo.action', checks: [{ name: 'evidence', ok: true, evidence: 'persisted' }] });
  await manager.recover();
  assert.equal(episodeStore.get('live-current').pendingWrites[0].status, 'confirmed');
  assert.equal(manager.status().recoveryRequired, false);
  assert.equal(skillLibrary.list().length, 1);
  const streamWrite = episode.addPendingWrite('stream.propose', { args: { action: 'start', intentId: 'I-stream' }, refs: { intentId: 'I-stream' }, residenceId: 'system' });
  episodeStore.save(episode);
  afterAction.record({ taskId: streamWrite.id, residenceId: 'system', goal: 'stream.propose', checks: [{ name: 'verified_live', ok: true, evidence: 'persisted-live-evidence' }] });
  await manager.recover();
  assert.equal(episodeStore.get('live-current').pendingWrites.find((item) => item.id === streamWrite.id).status, 'confirmed');
  assert.equal(skillLibrary.list().length, 1, 'Control 恢复不得把 stream 结果学习为技能');
  const empty = new RecoveryManager({ file: `${root}/empty-lifecycle.json`, episodeStore: new EpisodeStore({ root: `${root}/empty-episodes` }), afterAction, skillLibrary });
  empty.boot();
  empty.stopping();
  assert.equal(empty.boot().recoveryRequired, true);
  await empty.recover();
  assert.equal(empty.status().recoveryRequired, false, '无 Episode 的基础实例也必须能完成恢复核对');

  let stream = { state: 'stopped', output: { state: 'running' }, live: false };
  let streamReads = 0;
  const streamRecovery = new RecoveryManager({
    file: `${root}/stream-lifecycle.json`,
    episodeStore: new EpisodeStore({ root: `${root}/stream-episodes` }),
    afterAction,
    skillLibrary,
    streamStatus: () => { streamReads++; return stream; },
  });
  assert.equal(streamRecovery.status().recoveryRequired, true, '调度 stopped 但输出仍运行也必须要求恢复');
  assert.equal(streamRecovery.status().stream.requiresAttention, true);
  stream = { state: 'interrupted', output: { state: 'stopped' }, live: false };
  assert.equal(streamRecovery.status().recoveryRequired, true, 'interrupted 必须对 Owner 可见');
  stream = { state: 'stopped', output: { state: 'stopped' }, live: false };
  assert.equal(streamRecovery.status().recoveryRequired, false);
  assert.equal(streamRecovery.status().stream.requiresAttention, false);
  assert.equal(streamReads, 5, '恢复只读取调度状态，不调用任何启停执行器');
  console.log('ok: 正常/异常停止识别、只读恢复、pending 清理与成功技能门槛');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
