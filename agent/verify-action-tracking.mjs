import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AfterActionStore, verifyChecks } from './after-action.mjs';
import { EpisodeStore } from './episode-store.mjs';
import { ActionTracker } from './action-tracker.mjs';
import { SkillLibrary } from './skill-library.mjs';
import { voiceSpeakChecks, outletStartChecks, outletStopChecks, qqReplyChecks } from './action-verifiers.mjs';

const root = `/tmp/habitat-action-tracking-${process.pid}`;
const sleep = () => Promise.resolve();
try {
  assert.equal(verifyChecks([{ name: 'pending', ok: null, evidence: 'pending' }]).outcome, 'unknown');
  let voiceState = { id: 7, status: 'pending', playback: null };
  const voice = { getUtterance: async () => voiceState };
  let checks = await voiceSpeakChecks({ data: { refs: { utteranceId: 7 } } }, null, { voice });
  assert.equal(verifyChecks(checks).outcome, 'unknown');
  voiceState = { id: 7, status: 'ready', hash: 'abc', bytes: 100, playback: null };
  checks = await voiceSpeakChecks({ data: { refs: { utteranceId: 7 } } }, null, { voice });
  assert.equal(verifyChecks(checks).outcome, 'unknown', '合成完成不等于播放完成');
  voiceState.playback = { state: 'completed', at: 10 };
  checks = await voiceSpeakChecks({ data: { refs: { utteranceId: 7 } } }, null, { voice });
  assert.equal(verifyChecks(checks).outcome, 'verified_success');

  const qqRuntime = { onebotClient: { getMsg: async () => ({ message_id: 99 }) } };
  const qqWrite = { data: { refs: { messageId: 99 }, residenceId: 'qq.group.test' } };
  checks = await qqReplyChecks(qqWrite, { message_id: 99, residenceId: 'qq.group.test' }, { qqRuntime });
  assert.equal(verifyChecks(checks).outcome, 'verified_success');
  checks = await qqReplyChecks(qqWrite, { message_id: 99, residenceId: 'qq.group.test', deduped: true }, { qqRuntime });
  assert.equal(verifyChecks(checks).outcome, 'unknown', '去重结果不能记成一次新的发送技能');
  const historyRuntime = {
    onebotClient: {
      getMsg: async () => { throw new Error('message cache expired'); },
      getGroupMsgHistory: async () => [{ message_id: 99 }],
    },
  };
  checks = await qqReplyChecks(qqWrite, { message_id: 99, residenceId: 'qq.group.test' }, { qqRuntime: historyRuntime });
  assert.equal(verifyChecks(checks).outcome, 'verified_success', '群历史可作为缓存丢失后的真实证据');

  const startIo = {
    outletStatus: async () => ({ hls: { instanceId: 'I1', running: true, state: 'running', pid: 10 } }),
    readPipeline: () => ({ instanceId: 'I1', captureId: 'C1', audioCaptureId: 'A1', framesOut: 27, frameSeq: 17 }),
    playlistExists: () => true,
    waitMs: 0,
    sleep,
  };
  checks = await outletStartChecks({ data: { refs: { instanceId: 'I1' } } }, null, startIo);
  assert.equal(verifyChecks(checks).outcome, 'verified_success');
  checks = await outletStartChecks({ data: { refs: { instanceId: 'I1' } } }, null, {
    ...startIo,
    readPipeline: () => ({ instanceId: 'OLD', framesOut: 999 }),
  });
  assert.equal(verifyChecks(checks).outcome, 'unknown', '旧实例帧不能证明本次启动');

  const stopIo = {
    outletStatus: async () => ({ hls: { instanceId: 'I1', running: false, state: 'stopped' } }),
    readPipeline: () => ({ instanceId: 'I1', state: 'stopped', captureId: null, audioCaptureId: null }),
    desktopCaptures: async () => [],
    audioStatus: async () => ({ captures: [] }),
  };
  checks = await outletStopChecks({ data: { refs: { instanceId: 'I1' } } }, { stopped: true, instanceId: 'I1', exitCode: 0 }, stopIo);
  assert.equal(verifyChecks(checks).outcome, 'verified_success');

  const episodeStore = new EpisodeStore({ root: `${root}/episodes` });
  const afterAction = new AfterActionStore({ file: `${root}/after.jsonl` });
  const skillLibrary = new SkillLibrary({ file: `${root}/skills.json` });
  let episode = episodeStore.create({ id: 'E1', goal: 'verify actions', participants: ['system'] });
  const tracker = new ActionTracker({ episode, episodeStore, afterAction, skillLibrary });
  let evidenceReady = false;
  let runs = 0;
  tracker.register('demo.action', async () => [{
    name: 'evidence', ok: evidenceReady ? true : null, evidence: evidenceReady ? 'ready' : 'pending',
  }], (result) => ({ evidenceId: result.evidenceId }));
  const tracked = await tracker.track({
    kind: 'demo.action',
    args: { value: 1 },
    run: async () => { runs++; return { evidenceId: 'R1' }; },
  });
  assert.equal(tracked.afterAction.verification.outcome, 'unknown');
  assert.equal(skillLibrary.list().length, 0);
  evidenceReady = true;
  await tracker.reconcile({ minIntervalMs: 0 });
  assert.equal(episode.pendingWrites[0].status, 'confirmed');
  assert.equal(skillLibrary.list().length, 1, '迟到验证成功后才可进入 SkillLibrary');
  assert.equal(runs, 1, '核对迟到证据不能重放动作');

  const failed = tracker.track({
    kind: 'demo.action',
    args: {},
    run: async () => { throw new Error('actual failure'); },
  });
  await assert.rejects(() => failed, /actual failure/);
  assert.equal(skillLibrary.list()[0].successCount, 1, '失败不能增加技能成功计数');

  episode = episodeStore.create({ id: 'E3', goal: 'dedupe intent', participants: ['system'] });
  const dedupe = new ActionTracker({ episode, episodeStore, afterAction, skillLibrary });
  let dedupeRuns = 0;
  dedupe.register('demo.action', async () => [{ name: 'evidence', ok: true, evidence: 'ready' }], () => ({}));
  const dedupeArgs = { idempotencyKey: 'K1' };
  const first = await dedupe.track({ kind: 'demo.action', args: dedupeArgs, run: async () => { dedupeRuns++; return { ok: true }; } });
  const second = await dedupe.track({ kind: 'demo.action', args: dedupeArgs, run: async () => { dedupeRuns++; return { ok: true, deduped: true }; } });
  assert.equal(dedupeRuns, 2);
  assert.equal(second.deduped, true);
  assert.equal(second.afterAction.id, first.afterAction.id);
  assert.equal(episode.pendingWrites.length, 1, '同一 idempotencyKey 只能有一个 pending write');

  episode = episodeStore.create({ id: 'E2', goal: 'recover report', participants: ['system'] });
  const pending = episode.addPendingWrite('demo.action', { args: {}, residenceId: 'system' });
  episodeStore.save(episode);
  afterAction.record({
    taskId: pending.id,
    residenceId: 'system',
    goal: 'demo.action',
    checks: [{ name: 'persisted evidence', ok: true, evidence: 'confirmed-before-crash' }],
  });
  const restored = episodeStore.get('E2');
  const recovery = new ActionTracker({ episode: restored, episodeStore, afterAction, skillLibrary });
  await recovery.reconcile({ minIntervalMs: 0 });
  assert.equal(restored.pendingWrites[0].status, 'confirmed');
  assert.equal(runs, 1, '重启恢复不执行任何副作用');
  assert.ok(skillLibrary.list().some((skill) => skill.evidence.length >= 1));

  console.log('ok: voice/outlet 证据、pending/unknown、迟到结果、崩溃恢复与 SkillLibrary 成功门槛');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
