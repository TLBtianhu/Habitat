import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { StreamPolicyStore } from './stream-policy.mjs';
import { StreamScheduler } from './stream-scheduler.mjs';
import { writeLiveConfig } from './bilibili-live-config.mjs';

const root = path.join(process.cwd(), '.tmp', `stream-scheduler-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const configPath = path.join(root, 'bilibili-live.json');
writeLiveConfig(configPath, { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'live_123_456&key=abc' });
let now = 100000;
let starts = 0;
let stops = 0;
let output = { state: 'stopped', lastError: null };
let verification = { state: 'stopped', verified: false, lastCheckedAt: null, lastVerifiedAt: null, lastError: null, liveStatus: 0, playbackDecoded: false };
const scenePreview = {
  bilibiliConfigPath: configPath,
  status() { return { bilibili: output, verification, network: { mode: 'direct', supported: true, lastResult: 'reachable', lastError: null } }; },
  async startBilibili() {
    starts += 1;
    output = { state: 'running', lastError: null };
    verification = { state: 'checking', verified: false, lastCheckedAt: now, lastVerifiedAt: null, lastError: null, liveStatus: 0, playbackDecoded: false };
    return this.status();
  },
  async verifyBilibili() {
    verification = { state: 'verified', verified: true, lastCheckedAt: now, lastVerifiedAt: now, lastError: null, liveStatus: 1, playbackDecoded: true };
    return verification;
  },
  async stopBilibili() {
    stops += 1;
    output = { state: 'stopped', lastError: null };
    verification = { ...verification, state: 'stopped', verified: false, playbackDecoded: false };
    return this.status();
  },
};
const policyStore = new StreamPolicyStore({ file: path.join(root, 'stream-policy.json') });
const previousSchedulerFile = process.env.HABITAT_STREAM_SCHEDULER_FILE;
process.env.HABITAT_STREAM_SCHEDULER_FILE = path.join(root, 'stream-scheduler-state.json');
const scheduler = new StreamScheduler({ scenePreview, policyStore, now: () => now, tickMs: 1000 });
try {
  const disabled = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(disabled.state, 'proposed');
  assert.equal(disabled.started, false);
  assert.equal(starts, 0);
  const ownerStart = await scheduler.propose({ action: 'start', actor: 'owner', maxDurationMs: 60000 });
  assert.equal(ownerStart.state, 'starting');
  assert.equal(starts, 1);
  assert.ok(ownerStart.lastIntentId);
  const live = await scheduler.tick();
  assert.equal(live.state, 'live');
  assert.equal(live.live, true);
  assert.equal(live.verification.playbackDecoded, true);

  // 已取得的 LIVE 证据一旦过期或输出重连，就不能继续显示 LIVE。
  output = { state: 'reconnecting', lastError: null };
  verification = { ...verification, state: 'stale', verified: false, playbackDecoded: false };
  const stale = scheduler.status();
  assert.equal(stale.state, 'reconnecting');
  assert.equal(stale.live, false);
  output = { state: 'running', lastError: null };
  verification = { ...verification, state: 'verified', verified: true, playbackDecoded: true };

  // 验证 await 期间的 owner 停止必须排队执行，不能返回旧状态并留下推流进程。
  let finishVerification;
  scenePreview.verifyBilibili = () => new Promise((resolve) => { finishVerification = resolve; });
  const ticking = scheduler.tick();
  const stopDuringTick = scheduler.stop({ actor: 'owner' });
  const duplicateStop = scheduler.stop({ actor: 'owner' });
  assert.equal(scheduler.status().state, 'stopping');
  assert.equal(scheduler.status().live, false);
  const stopsBeforeConcurrentStop = stops;
  finishVerification({ state: 'verified', verified: true, lastCheckedAt: now, lastVerifiedAt: now, lastError: null, liveStatus: 1, playbackDecoded: true });
  const stoppedDuringTick = await stopDuringTick;
  await duplicateStop;
  await ticking;
  assert.equal(stoppedDuringTick.state, 'stopped');
  assert.equal(stoppedDuringTick.live, false);
  assert.equal(stoppedDuringTick.stopReason, 'owner');
  assert.equal(output.state, 'stopped');
  assert.equal(stops, stopsBeforeConcurrentStop + 1);

  now += 1000;
  policyStore.save({ autonomous: 'anytime', cooldownMs: 0 });
  scenePreview.verifyBilibili = async () => {
    verification = { state: 'verified', verified: true, lastCheckedAt: now, lastVerifiedAt: now, lastError: null, liveStatus: 1, playbackDecoded: true };
    return verification;
  };
  const agentStart = await scheduler.propose({ action: 'start', actor: 'agent', maxDurationMs: 60000 });
  assert.equal(agentStart.state, 'starting');
  assert.equal(agentStart.lastActor, 'agent');
  assert.equal(starts, 2);
  const agentLive = await scheduler.tick();
  assert.equal(agentLive.state, 'live');
  const agentStop = await scheduler.propose({ action: 'stop', actor: 'agent', intentId: agentLive.lastIntentId });
  assert.equal(agentStop.state, 'stopped');
  assert.equal(agentStop.stopReason, 'agent');
  const runsBeforeReplay = starts;
  const replay = await scheduler.propose({ action: 'start', actor: 'agent', intentId: agentStart.lastIntentId });
  assert.equal(replay.reason, 'duplicate_intent');
  assert.equal(replay.deduped, true);
  assert.equal(starts, runsBeforeReplay, '同一 intent 重启不得再次推流');
  const agentStoppedAt = scheduler.lastStoppedAt;
  policyStore.save({ autonomous: 'off', cooldownMs: 600000 });
  assert.equal(scheduler.status().cooldownUntil, agentStoppedAt + 600000, '临时 0 冷却验收后必须恢复当前策略的实际冷却');
  policyStore.save({ autonomous: 'anytime', cooldownMs: 0 });
  const forbidden = await scheduler.propose({ action: 'stop', actor: 'agent', intentId: 'wrong' });
  assert.equal(forbidden.reason, 'forbidden');

  const ownerSession = await scheduler.start({ actor: 'owner', intentId: 'owner-only-session', maxDurationMs: 60000 });
  assert.equal(ownerSession.lastActor, 'owner');
  const ownerStopsBefore = stops;
  const ownerStopDenied = await scheduler.propose({ action: 'stop', actor: 'agent', intentId: ownerSession.lastIntentId });
  assert.equal(ownerStopDenied.reason, 'forbidden');
  assert.equal(stops, ownerStopsBefore, 'Agent 不得停止 Owner 的会话');
  await scheduler.stop({ actor: 'owner' });

  await scheduler.start({ actor: 'owner', maxDurationMs: 1000 });
  now += 1000;
  const maxStopped = await scheduler.tick();
  assert.equal(maxStopped.state, 'stopped');
  assert.equal(maxStopped.stopReason, 'max_duration');
  assert.ok(maxStopped.dailyMs >= 1000);

  scenePreview.verifyBilibili = async () => {
    verification = { state: 'degraded', verified: false, lastCheckedAt: now, lastVerifiedAt: null, lastError: 'playback failed', liveStatus: 0, playbackDecoded: false };
    return verification;
  };
  await scheduler.start({ actor: 'owner', maxDurationMs: 120000 });
  now += 60000;
  const failed = await scheduler.tick();
  assert.equal(failed.state, 'stopped');
  assert.equal(failed.stopReason, 'verification_failed');
  assert.ok(failed.lastError.includes('playback failed'));
  assert.equal(failed.requiresRefresh, true);

  scenePreview.verifyBilibili = async () => {
    verification = { state: 'verified', verified: true, lastCheckedAt: now, lastVerifiedAt: now, lastError: null, liveStatus: 1, playbackDecoded: true };
    return verification;
  };
  policyStore.save({ autonomous: 'anytime', cooldownMs: 10000 });
  await scheduler.start({ actor: 'owner', maxDurationMs: 1000 });
  await scheduler.stop({ actor: 'owner' });
  const cooling = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(cooling.state, 'scheduled');
  assert.equal(cooling.reason, 'cooldown');
  const ownerBypass = await scheduler.start({ actor: 'owner', maxDurationMs: 1000 });
  assert.equal(ownerBypass.state, 'starting');
  await scheduler.stop({ actor: 'owner' });
  const coolingAgain = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(coolingAgain.state, 'scheduled');
  const scheduledIntentId = coolingAgain.pending.intentId;
  const startsBeforeCancel = starts;
  const cancelled = await scheduler.propose({ action: 'stop', actor: 'agent', intentId: scheduledIntentId });
  assert.equal(cancelled.state, 'stopped');
  assert.equal(cancelled.stopReason, 'agent');
  assert.equal(starts, startsBeforeCancel, 'Agent 可取消自己的 scheduled 意图，但不能启动输出');
  const rescheduled = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(rescheduled.state, 'scheduled');
  now += 10000;
  await scheduler.tick();
  assert.equal(starts >= 5, true);

  policyStore.save({ autonomous: 'anytime', maxDurationMs: 1000, maxDailyMs: 1000, cooldownMs: 0 });
  scheduler.dailyMs = 0;
  await scheduler.start({ actor: 'owner', maxDurationMs: 1000 });
  now += 1000;
  const daily = await scheduler.tick();
  assert.equal(daily.stopReason, 'daily_limit');
  const blocked = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(blocked.reason, 'daily_limit');

  policyStore.save({ autonomous: 'windowed', maxDailyMs: 7200000, cooldownMs: 0, windows: [{ start: '20:00', end: '20:30', days: [6] }] });
  scheduler.dailyMs = 0;
  now = new Date('2026-11-07T11:00:00Z').getTime();
  const outside = await scheduler.propose({ action: 'start', actor: 'agent' });
  assert.equal(outside.state, 'scheduled');
  assert.equal(outside.reason, 'outside_window');
  now = new Date('2026-11-07T12:10:00Z').getTime();
  await scheduler.tick();
  const windowLive = await scheduler.tick();
  assert.equal(windowLive.state, 'live');
  await scheduler.stop({ actor: 'owner' });

  const activeSchedulerFile = process.env.HABITAT_STREAM_SCHEDULER_FILE;
  process.env.HABITAT_STREAM_SCHEDULER_FILE = path.join(root, 'scheduled-restart.json');
  const candidate = new StreamScheduler({ scenePreview, policyStore, now: () => now, tickMs: 60000 });
  now = new Date('2026-11-07T11:00:00Z').getTime();
  const scheduled = await candidate.propose({ action: 'start', actor: 'agent' });
  assert.equal(scheduled.state, 'scheduled');
  const startsBeforeRestart = starts;
  const rebooted = new StreamScheduler({ scenePreview, policyStore, now: () => now, tickMs: 60000 });
  assert.equal(rebooted.state, 'interrupted');
  assert.equal(rebooted.pending, null, '重启必须隔离 scheduled 意图');
  await rebooted.tick();
  assert.equal(starts, startsBeforeRestart, '重启后的只读 tick 不得执行 scheduled 开播');
  await rebooted.stop({ actor: 'owner' });
  candidate.stopTimer();
  rebooted.stopTimer();
  process.env.HABITAT_STREAM_SCHEDULER_FILE = activeSchedulerFile;
  console.log('ok: StreamScheduler off/owner/agent、冷却、单次/每日时长、验证失败、时间窗和强制停止');
} finally {
  await scheduler.stop({ actor: 'owner' }).catch(() => {});
  scheduler.stopTimer();
  if (previousSchedulerFile === undefined) delete process.env.HABITAT_STREAM_SCHEDULER_FILE;
  else process.env.HABITAT_STREAM_SCHEDULER_FILE = previousSchedulerFile;
  fs.rmSync(root, { recursive: true, force: true });
}
