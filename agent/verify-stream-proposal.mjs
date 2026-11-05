import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentLoop } from './agent-loop.mjs';
import { EpisodeStore } from './episode-store.mjs';
import { AfterActionStore, verifyChecks } from './after-action.mjs';
import { ActionTracker } from './action-tracker.mjs';
import { SkillLibrary } from './skill-library.mjs';
import { StreamPolicyStore } from '../stream/stream-policy.mjs';
import { StreamScheduler } from '../stream/stream-scheduler.mjs';
import { agentStreamStatus } from '../stream/agent-status.mjs';
import { writeLiveConfig } from '../stream/bilibili-live-config.mjs';
import { StreamControlClient, createStreamProposalHandler, registerStreamActionTracker, streamProposalChecks } from './stream-proposal.mjs';

const root = path.join(process.cwd(), '.tmp', `stream-proposal-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const configPath = path.join(root, 'live.json');
writeLiveConfig(configPath, { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'unit-test-not-a-credential' });
const previousSchedulerFile = process.env.HABITAT_STREAM_SCHEDULER_FILE;
process.env.HABITAT_STREAM_SCHEDULER_FILE = path.join(root, 'scheduler.json');
let now = Date.now();
let starts = 0;
let stops = 0;
let output = { state: 'stopped', lastError: null };
let verification = { state: 'stopped', verified: false, lastVerifiedAt: null, lastError: null, liveStatus: 0, playbackDecoded: false };
const scenePreview = {
  bilibiliConfigPath: configPath,
  status() { return { bilibili: output, verification, network: { mode: 'direct', supported: true, lastResult: 'reachable', lastError: null } }; },
  async startBilibili() {
    starts++;
    output = { state: 'running', lastError: null };
    verification = { state: 'checking', verified: false, lastVerifiedAt: null, lastError: null, liveStatus: 0, playbackDecoded: false };
  },
  async stopBilibili() {
    stops++;
    output = { state: 'stopped', lastError: null };
    verification = { ...verification, state: 'stopped', verified: false, playbackDecoded: false };
  },
  async verifyBilibili() {
    verification = { state: 'verified', verified: true, lastCheckedAt: now, lastVerifiedAt: now, lastError: null, liveStatus: 1, playbackDecoded: true };
    return verification;
  },
};
const policyStore = new StreamPolicyStore({ file: path.join(root, 'policy.json') });
const scheduler = new StreamScheduler({ scenePreview, policyStore, now: () => now, tickMs: 60000 });
const episodeStore = new EpisodeStore({ root: path.join(root, 'episodes') });
const episode = episodeStore.create({ id: 'stream-agent-test', goal: 'verify stream proposals', participants: ['system'] });
const afterAction = new AfterActionStore({ file: path.join(root, 'after.jsonl') });
const skillLibrary = new SkillLibrary({ file: path.join(root, 'skills.json') });
const tracker = new ActionTracker({ episode, episodeStore, afterAction, skillLibrary });
let statusCalls = 0;
let proposeCalls = 0;
const client = {
  async status() { statusCalls++; return agentStreamStatus(scheduler.status(), policyStore.get()); },
  async propose(payload) { proposeCalls++; return scheduler.propose({ ...payload, actor: 'agent' }); },
};
registerStreamActionTracker(tracker, { readStatus: () => client.status() });
let residence = null;
let eventIds = ['owner-request-1'];
const handler = createStreamProposalHandler({
  client, actionTracker: tracker, episode, episodeStore,
  getResidence: () => residence,
  getEventIds: () => eventIds,
});
try {
  // 真实 AgentLoop 在 off 下只能得到明确的未开播结果。
  const loop = new AgentLoop({
    broker: { call: (verb, args) => { assert.equal(verb, 'stream.propose'); return handler(args); } },
    decider: async () => ({ verb: 'stream.propose', args: { action: 'start' } }),
  });
  const off = await loop.tick({});
  assert.equal(off.result.state, 'proposed');
  assert.equal(off.result.reason, 'autonomous_disabled');
  assert.equal(off.result.afterAction.outcome, 'verified_failure');
  assert.equal(starts, 0);
  assert.equal(proposeCalls, 1);
  assert.equal(episode.checkpoint.streamProposal.reason, 'autonomous_disabled');
  assert.equal(skillLibrary.list().length, 0);

  // 即使后来改成 anytime，相同事件也不能重新执行。
  policyStore.save({ autonomous: 'anytime', cooldownMs: 0 });
  const replayOff = await handler({ action: 'start' });
  assert.equal(replayOff.reason, 'duplicate_intent');
  assert.equal(replayOff.deduped, true);
  assert.equal(proposeCalls, 1);
  assert.equal(starts, 0);

  await assert.rejects(() => handler({ action: 'start', rtmpUrl: 'rtmp://example.invalid/secret' }), /unsupported stream argument/);
  await assert.rejects(() => handler({ action: 'start', streamKey: 'secret' }), /unsupported stream argument/);
  residence = { residenceId: 'qq.group.123' };
  await assert.rejects(() => handler({ action: 'start' }), /cross_channel_denied/);
  residence = null;
  assert.equal(proposeCalls, 1);
  assert.equal(starts, 0);

  eventIds = ['owner-request-2'];
  const started = await handler({ action: 'start', maxDurationMs: 60000 });
  assert.equal(started.state, 'starting');
  assert.equal(started.lastActor, 'agent');
  assert.equal(starts, 1);
  const intentId = started.lastIntentId;
  assert.ok(intentId);
  const startWrite = episode.pendingWrites.find((write) => write.data.args.intentId === intentId && write.data.args.action === 'start');
  assert.equal(startWrite.data.refs.intentId, intentId);
  assert.equal(startWrite.outcome, 'unknown');
  const view = await client.status();
  assert.equal(view.lastIntentId, intentId);
  assert.equal(view.canStop, true);
  assert.ok(!JSON.stringify(view).includes('unit-test-not-a-credential'));

  await scheduler.tick();
  assert.equal(scheduler.status().live, true);
  await tracker.reconcile({ minIntervalMs: 0 });
  assert.equal(startWrite.status, 'confirmed');
  assert.ok(startWrite.data.refs.firstVerifiedLiveAt);
  assert.equal(skillLibrary.list().length, 0, '开播证据不能变成可复用技能');

  const runningDuplicate = await handler({ action: 'start' });
  assert.equal(runningDuplicate.deduped, true);
  assert.equal(starts, 1);
  const stopped = await handler({ action: 'stop' });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.stopReason, 'agent');
  assert.equal(stops, 1);
  const stopWrite = episode.pendingWrites.find((write) => write.data.args.intentId === intentId && write.data.args.action === 'stop');
  assert.equal(stopWrite.status, 'confirmed');
  assert.notEqual(startWrite.data.idempotencyKey, stopWrite.data.idempotencyKey, 'start/stop 必须使用前綴隔离幂等键');

  // LIVE 后先停止，Agent 随后复盘，仍能使用同一 intent 的历史播放证据。
  eventIds = ['owner-request-3'];
  const late = await handler({ action: 'start' });
  const lateWrite = episode.pendingWrites.find((write) => write.data.args.intentId === late.lastIntentId && write.data.args.action === 'start');
  await scheduler.tick();
  await scheduler.stop({ actor: 'agent', reason: 'agent' });
  await tracker.reconcile({ minIntervalMs: 0 });
  assert.equal(lateWrite.status, 'confirmed');
  assert.ok(lateWrite.data.refs.firstVerifiedLiveAt);

  // 执行已被接受、响应却丢失：initial refs 让新 tracker 只读恢复，不再次 propose。
  eventIds = ['owner-request-crash'];
  now += 1000;
  const realPropose = client.propose;
  client.propose = async (payload) => {
    await realPropose(payload);
    return { state: 'unknown', started: false, reason: 'evidence_unavailable' };
  };
  const lostResponse = await handler({ action: 'start' });
  assert.equal(lostResponse.reason, 'evidence_unavailable');
  const lostIntentId = lostResponse.lastIntentId || episode.checkpoint.streamProposal.intentId;
  const restored = episodeStore.get(episode.id);
  const restoredWrite = restored.pendingWrites.find((write) => write.data.args.intentId === lostIntentId && write.data.args.action === 'start');
  assert.equal(restoredWrite.data.refs.intentId, lostIntentId);
  const startsBeforeRecovery = starts;
  const proposalsBeforeRecovery = proposeCalls;
  const restoredTracker = new ActionTracker({ episode: restored, episodeStore, afterAction, skillLibrary });
  registerStreamActionTracker(restoredTracker, { readStatus: () => client.status() });
  client.propose = realPropose;
  await scheduler.tick();
  await restoredTracker.reconcile({ minIntervalMs: 0 });
  assert.equal(restoredWrite.status, 'confirmed');
  assert.equal(starts, startsBeforeRecovery, '恢复不得再次执行输出启动');
  assert.equal(proposeCalls, proposalsBeforeRecovery, '恢复不得再次发送 propose');
  await scheduler.stop({ actor: 'agent', reason: 'agent' });

  // 明确的验证失败是 start 失败；独立的已停止停止请求仍可以成功。
  eventIds = ['owner-request-4'];
  scenePreview.verifyBilibili = async () => {
    verification = { state: 'degraded', verified: false, lastCheckedAt: now, lastVerifiedAt: null, lastError: 'playback failed', liveStatus: 0, playbackDecoded: false };
    return verification;
  };
  const failed = await handler({ action: 'start' });
  const failedWrite = episode.pendingWrites.find((write) => write.data.args.intentId === failed.lastIntentId && write.data.args.action === 'start');
  now += 60000;
  await scheduler.tick();
  await tracker.reconcile({ minIntervalMs: 0 });
  assert.equal(failedWrite.status, 'failed');
  const independentStop = await handler({ action: 'stop' });
  assert.equal(independentStop.afterAction.outcome, 'verified_success');

  // Owner 会话的 intentId 永不出现在 Agent 投影中。
  const ownerView = agentStreamStatus({ ...scheduler.status(), lastActor: 'owner', lastIntentId: 'owner-private-intent' }, policyStore.get());
  assert.equal(ownerView.lastIntentId, null);
  assert.equal(ownerView.canStop, false);
  assert.ok(!JSON.stringify(ownerView).includes('owner-private-intent'));

  // HTTP 传输结果不明时 unknown，不重试、不伪造执行失败。
  let attempts = 0;
  const ambiguousClient = new StreamControlClient({
    baseUrl: 'http://127.0.0.1:9240', token: 'test-token',
    fetchImpl: async () => { attempts++; throw new Error('socket closed after dispatch'); },
  });
  const ambiguous = await ambiguousClient.propose({ action: 'start', intentId: 'agent-ambiguous' });
  assert.equal(ambiguous.reason, 'evidence_unavailable');
  assert.equal(attempts, 1);
  const ambiguousChecks = await streamProposalChecks({ at: now, data: { args: { action: 'start', intentId: 'agent-ambiguous' }, refs: {} } }, ambiguous, { readStatus: () => { throw new Error('must not infer'); } });
  assert.equal(verifyChecks(ambiguousChecks).outcome, 'unknown');

  // 客户端只访问 Agent 只读状态和 propose，绝不访问 Owner 启停。
  const requests = [];
  const httpClient = new StreamControlClient({
    baseUrl: 'http://127.0.0.1:9240', token: 'test-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ state: 'stopped', started: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await httpClient.status();
  await httpClient.propose({ action: 'start', intentId: 'agent-http' });
  assert.ok(requests[0].url.endsWith('/stream/agent/status'));
  assert.ok(requests[1].url.endsWith('/stream/propose'));
  assert.ok(!requests.some((request) => /stream\/(start|stop)|bilibili\/live\/start/.test(request.url)));
  assert.ok(!requests.some((request) => request.url.includes('test-token')));

  assert.ok(statusCalls > 0);
  assert.ok(proposeCalls >= 4);
  console.log('ok: 真实 AgentLoop stream.propose、权限、去重、跨渠道、证据与传输不确定性');
} finally {
  await scheduler.stop({ actor: 'owner' }).catch(() => {});
  scheduler.stopTimer();
  if (previousSchedulerFile === undefined) delete process.env.HABITAT_STREAM_SCHEDULER_FILE;
  else process.env.HABITAT_STREAM_SCHEDULER_FILE = previousSchedulerFile;
  fs.rmSync(root, { recursive: true, force: true });
}
