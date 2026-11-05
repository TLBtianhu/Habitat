// Agent 的受限开播意图入口：凭证只在客户端内部使用，模型只能看到闭合参数与脱敏状态。
import fs from 'node:fs';
import crypto from 'node:crypto';

function safeError(error) {
  return String(error?.message || error)
    .replace(/(?:rtmps?|https?):\/\/\S+/gi, '[url]')
    .replace(/((?:key|trid)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 300);
}

export function normalizeStreamProposal(args, { startIntentId = null } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('stream arguments must be an object');
  if (!['start', 'stop'].includes(args.action)) throw new Error('stream action must be start or stop');
  const allowed = args.action === 'start'
    ? new Set(['action', 'room', 'scene', 'maxDurationMs'])
    : new Set(['action', 'intentId']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`unsupported stream argument: ${key}`);
  if (args.action === 'stop') {
    if (typeof args.intentId !== 'string' || !/^[a-z0-9:_-]{1,80}$/i.test(args.intentId)) throw new Error('agent intentId required for stop');
    return { action: 'stop', intentId: args.intentId };
  }
  const result = {
    action: 'start',
    room: args.room ?? 'default',
    scene: args.scene ?? 'desktop-main',
    intentId: startIntentId,
  };
  for (const key of ['room', 'scene']) {
    if (typeof result[key] !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(result[key])) throw new Error(`invalid stream ${key}`);
  }
  if (args.maxDurationMs !== undefined) {
    if (!Number.isSafeInteger(args.maxDurationMs) || args.maxDurationMs < 1000 || args.maxDurationMs > 86400000) throw new Error('invalid stream maxDurationMs');
    result.maxDurationMs = args.maxDurationMs;
  }
  if (typeof result.intentId !== 'string' || !/^[a-z0-9:_-]{1,80}$/i.test(result.intentId)) throw new Error('internal stream intentId required');
  return result;
}

export class StreamControlClient {
  constructor({ baseUrl = process.env.HABITAT_CONTROL_URL || 'http://127.0.0.1:9240', tokenFile = process.env.HABITAT_AGENT_TOKEN_FILE || '/etc/habitat/agent.token', token = null, fetchImpl = fetch, timeoutMs = 40000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token || fs.readFileSync(tokenFile, 'utf8').trim();
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body = null, timeoutMs = this.timeoutMs } = {}) {
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // POST 已可能到达控制面：网络错误不是确定的执行失败，禁止自动重试，后续只读核对。
      if (body) return { state: 'unknown', started: false, reason: 'evidence_unavailable', lastError: safeError(error) };
      throw new Error(`stream control unavailable: ${safeError(error)}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(safeError(data.error || `stream control HTTP ${response.status}`));
    return data;
  }

  status() {
    // 只读接口不得调用 scheduler.tick()，复盘和观测本身不能产生开播/停播副作用。
    return this.request('/stream/agent/status', { timeoutMs: Math.min(10000, this.timeoutMs) });
  }

  propose(payload) {
    return this.request('/stream/propose', { method: 'POST', body: payload });
  }
}

export async function streamProposalChecks(write, result, { readStatus }) {
  const action = write.data?.args?.action;
  const requestedIntentId = write.data?.args?.intentId || write.data?.refs?.intentId || null;
  if (result?.reason === 'forbidden') return [{ name: 'authorized', ok: false, evidence: 'forbidden' }];
  if (result?.reason === 'evidence_unavailable') {
    return [{ name: 'verified_result', ok: null, evidence: 'transport_outcome_unknown_no_retry' }];
  }
  if (action === 'stop') {
    const status = await readStatus();
    const identity = result?.lastIntentId === requestedIntentId || status.lastIntentId === requestedIntentId;
    const stoppedAt = result?.lastStoppedAt || status.lastStoppedAt;
    const accepted = result?.state === 'stopped' || (Number.isFinite(stoppedAt) && stoppedAt >= write.at);
    return [
      { name: 'agent_session', ok: Boolean(requestedIntentId && identity), evidence: requestedIntentId || 'missing_intent' },
      { name: 'output_stopped', ok: status.output?.state === 'stopped' && status.live === false, evidence: status.output?.state || 'unknown' },
      { name: 'stop_observed', ok: accepted ? true : null, evidence: stoppedAt || 'not_observed' },
    ];
  }
  if (result?.state === 'scheduled' || ['cooldown', 'outside_window'].includes(result?.reason)) {
    const pendingId = result.pending?.intentId || result.lastIntentId || requestedIntentId;
    return [
      { name: 'scheduled', ok: pendingId === requestedIntentId, evidence: result.reason || 'scheduled' },
      { name: 'verified_live', ok: null, evidence: 'scheduled_start_has_not_run' },
    ];
  }
  if (result?.reason === 'duplicate_intent' || result?.deduped) {
    return [
      { name: 'idempotent', ok: true, evidence: 'duplicate_intent_no_replay' },
      { name: 'verified_live', ok: null, evidence: 'existing evidence must be checked read-only' },
    ];
  }
  if (result && result.started === false) {
    const allowed = ['autonomous_disabled', 'requires_refresh', 'daily_limit', 'already_running_or_unavailable'].includes(result.reason);
    if (!allowed) return [{ name: 'start_accepted', ok: false, evidence: result.reason || result.stopReason || result.state || 'rejected' }];
    return [
      { name: 'policy_enforced', ok: true, evidence: result.reason },
      { name: 'verified_live', ok: false, evidence: `not_started:${result.reason}` },
    ];
  }
  const status = await readStatus();
  const identity = status.lastIntentId === requestedIntentId || result?.lastIntentId === requestedIntentId;
  const firstVerifiedLiveAt = status.verification?.lastVerifiedAt || write.data?.refs?.firstVerifiedLiveAt || null;
  const expectedStartedAt = write.data?.refs?.startedAt || null;
  const sameStart = expectedStartedAt ? status.startedAt === expectedStartedAt : status.startedAt >= write.at;
  const currentLive = Boolean(identity && status.state === 'live' && status.live === true
    && status.output?.state === 'running' && status.verification?.state === 'verified'
    && status.verification?.verified === true && status.verification?.playbackDecoded === true
    && firstVerifiedLiveAt && sameStart);
  const stoppedAt = status.lastStoppedAt || write.data?.refs?.lastStoppedAt || null;
  const stoppedAfterStart = expectedStartedAt ? stoppedAt >= expectedStartedAt : stoppedAt >= write.at;
  const historicalLive = Boolean(identity && firstVerifiedLiveAt && status.state === 'stopped'
    && status.output?.state === 'stopped' && stoppedAfterStart);
  if (currentLive || historicalLive) {
    write.data.refs = { ...(write.data.refs || {}), firstVerifiedLiveAt, lastStoppedAt: stoppedAt };
  }
  const failedBeforeLive = !firstVerifiedLiveAt && status.stopReason === 'verification_failed';
  return [
    { name: 'agent_session', ok: identity ? true : null, evidence: requestedIntentId || 'missing_intent' },
    {
      name: 'verified_live',
      ok: currentLive || historicalLive ? true : failedBeforeLive ? false : null,
      evidence: currentLive || historicalLive ? `firstVerifiedLiveAt:${firstVerifiedLiveAt}` : status.stopReason || status.state || 'not_observed',
    },
  ];
}

export function registerStreamActionTracker(tracker, { readStatus }) {
  tracker.register('stream.propose',
    (write, result) => streamProposalChecks(write, result, { readStatus }),
    (result, write) => ({
      intentId: result?.lastIntentId || result?.pending?.intentId || write.data?.refs?.intentId || null,
      disposition: result?.state || write.data?.refs?.disposition || null,
      reason: result?.reason || result?.stopReason || write.data?.refs?.reason || null,
      startedAt: result?.startedAt || write.data?.refs?.startedAt || null,
      firstVerifiedLiveAt: result?.verification?.lastVerifiedAt || write.data?.refs?.firstVerifiedLiveAt || null,
      lastStoppedAt: result?.lastStoppedAt || write.data?.refs?.lastStoppedAt || null,
    }),
    { recordSkill: false, allowDuplicateRun: false });
}

export function createStreamProposalHandler({ client, actionTracker, episode, episodeStore, getResidence = () => null, getEventIds = () => [], getDecisionKey = () => 'boot' }) {
  return async function propose(args) {
    const residence = getResidence();
    if (residence) throw new Error('cross_channel_denied:' + residence.residenceId);
    const eventIds = getEventIds().map(String).sort();
    const decisionKey = eventIds.length ? eventIds.join(',') : String(getDecisionKey());
    let requested = args;
    if (args?.action === 'stop' && args.intentId === undefined) {
      const status = await client.status();
      requested = { ...args, intentId: status.pending?.intentId || status.lastIntentId || undefined };
    }
    const startIntentId = requested?.action === 'start'
      ? `agent-${crypto.createHash('sha256').update(`stream.propose:${decisionKey}`).digest('hex').slice(0, 32)}`
      : null;
    const payload = normalizeStreamProposal(requested, { startIntentId });
    const idempotencyKey = payload.action === 'stop' ? `stream-stop:${payload.intentId}` : `stream-start:${payload.intentId}`;
    try {
      const tracked = await actionTracker.track({
        kind: 'stream.propose',
        args: { ...payload, idempotencyKey },
        residenceId: 'system',
        initialRefs: { intentId: payload.intentId },
        run: () => client.propose(payload),
      });
      const result = tracked.result || { ...await client.status(), reason: 'duplicate_intent', deduped: true };
      episode.checkpointState({
        streamProposal: {
          action: payload.action,
          intentId: payload.intentId,
          state: result.state,
          reason: result.reason || result.stopReason || null,
          outcome: tracked.afterAction?.verification?.outcome || 'unknown',
          at: Date.now(),
        },
      });
      episodeStore.save(episode);
      return { ...result, afterAction: tracked.afterAction?.verification || null, deduped: tracked.deduped === true || result.deduped === true };
    } catch (error) {
      episode.checkpointState({
        streamProposal: { action: payload.action, intentId: payload.intentId, state: 'error', reason: safeError(error), at: Date.now() },
      });
      episodeStore.save(episode);
      throw error;
    }
  };
}
