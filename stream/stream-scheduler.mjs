// StreamScheduler：受限自主开播。owner 始终可停止；agent 只能在策略窗口内 propose/start。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readLiveConfig, validateLiveConfig } from './bilibili-live-config.mjs';

function safeError(error) {
  return String(error?.message || error).replace(/(?:rtmps?|https?):\/\/\S+/gi, '[url]').replace(/live_\d+_\d+/g, '[stream-id]').replace(/key=[^&\s]+/gi, 'key=[redacted]').replace(/trid=[^&\s]+/gi, 'trid=[redacted]').slice(0, 500);
}

export class StreamScheduler {
  constructor({ scenePreview, policyStore, now = () => Date.now(), tickMs = 15000 }) {
    this.scenePreview = scenePreview;
    this.policyStore = policyStore;
    this.now = now;
    this.tickMs = tickMs;
    this.file = process.env.HABITAT_STREAM_SCHEDULER_FILE || '/opt/habitat/state/stream-scheduler.json';
    this.transitioning = false;
    this.stopRequests = [];
    this.timer = null;
    this.pending = null;
    this.lastIntentId = null;
    this.lastActor = null;
    this.startedAt = null;
    this.lastStoppedAt = null;
    this.cooldownUntil = 0;
    this.stopReason = null;
    this.lastError = null;
    this.dailyMs = 0;
    this.dailyDate = this.today();
    this.state = 'stopped';
    this.maxDurationMs = this.policyStore.get().maxDurationMs;
    this.room = 'default';
    this.scene = 'desktop-main';
    this.load();
  }

  today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.policyStore.get().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
  }

  rollDay() {
    const today = this.today();
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyMs = 0;
      this.persist();
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const previous = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.pending = previous.pending || null;
      this.lastIntentId = previous.lastIntentId || null;
      this.lastActor = previous.lastActor || null;
      this.startedAt = previous.startedAt || null;
      this.lastStoppedAt = previous.lastStoppedAt || null;
      this.cooldownUntil = previous.cooldownUntil || 0;
      this.stopReason = previous.stopReason || null;
      this.lastError = previous.lastError || null;
      this.dailyMs = Number(previous.dailyMs || 0);
      this.dailyDate = previous.dailyDate || this.today();
      this.maxDurationMs = previous.maxDurationMs || this.policyStore.get().maxDurationMs;
      this.room = previous.room || 'default';
      this.scene = previous.scene || 'desktop-main';
      this.state = previous.state || 'stopped';
      if (['scheduled', 'starting', 'live', 'reconnecting', 'stopping'].includes(this.state)) {
        this.state = 'interrupted';
        this.lastError = 'scheduler_restarted';
        this.stopReason = 'scheduler_restarted';
        this.lastStoppedAt = this.now();
        this.cooldownUntil = this.now() + this.policyStore.get().cooldownMs;
        this.startedAt = null;
        this.pending = null;
        this.persist();
      }
    } catch {
      this.state = 'interrupted';
      this.lastError = 'scheduler_state_invalid';
      this.pending = null;
      this.startedAt = null;
      this.cooldownUntil = this.now() + this.policyStore.get().cooldownMs;
      this.persist();
    }
  }

  persist() {
    const value = {
      state: this.state,
      pending: this.pending,
      lastIntentId: this.lastIntentId,
      lastActor: this.lastActor,
      startedAt: this.startedAt,
      lastStoppedAt: this.lastStoppedAt,
      cooldownUntil: this.cooldownUntil,
      stopReason: this.stopReason,
      lastError: this.lastError,
      dailyMs: this.dailyMs,
      dailyDate: this.dailyDate,
      maxDurationMs: this.maxDurationMs,
      room: this.room,
      scene: this.scene,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  status() {
    this.rollDay();
    const output = this.scenePreview.status().bilibili || { state: 'stopped', lastError: null };
    const verification = this.scenePreview.status().verification || { state: 'stopped', lastCheckedAt: null, lastVerifiedAt: null, lastError: null };
    const network = this.scenePreview.status().network || { mode: 'direct', supported: true, lastResult: 'unknown', lastError: null };
    const freshVerification = verification.lastVerifiedAt
      && this.now() - verification.lastVerifiedAt <= (verification.ttlMs || 45000);
    const live = this.state === 'live' && output.state === 'running'
      && verification.state === 'verified' && verification.verified === true && freshVerification;
    const state = this.state !== 'live' || live ? this.state
      : output.state === 'reconnecting' ? 'reconnecting'
        : ['failed', 'degraded'].includes(output.state) ? 'degraded'
          : output.state === 'stopped' ? 'interrupted' : 'starting';
    return {
      state,
      started: ['starting', 'live', 'reconnecting'].includes(state),
      live,
      lastIntentId: this.lastIntentId,
      lastActor: this.lastActor,
      startedAt: this.startedAt,
      lastStoppedAt: this.lastStoppedAt,
      cooldownUntil: this.effectiveCooldownUntil(),
      stopReason: this.stopReason,
      lastError: verification.lastError || output.lastError || this.lastError,
      dailyMs: this.dailyMs,
      dailyDate: this.dailyDate,
      maxDurationMs: this.maxDurationMs,
      maxDailyMs: this.policyStore.get().maxDailyMs,
      room: this.room,
      scene: this.scene,
      pending: this.pending,
      canStart: this.canStart(),
      requiresRefresh: this.requiresRefresh(),
      output,
      verification,
      network,
    };
  }

  effectiveCooldownUntil() {
    // 冷却随当前策略重算；临时验收或 owner 调整过 cooldownMs 后，不沿用旧的绝对截止时间。
    if (this.lastStoppedAt) return this.lastStoppedAt + this.policyStore.get().cooldownMs;
    return this.cooldownUntil;
  }

  canStart() {
    const output = this.scenePreview.status().bilibili || { state: 'stopped' };
    const network = this.scenePreview.status().network || { supported: true, lastResult: 'unknown' };
    const config = validateLiveConfig(readLiveConfig(this.scenePreview.bilibiliConfigPath));
    return Boolean(config.rtmpUrl && config.streamKey && network.supported && network.lastResult !== 'degraded' && !['starting', 'running', 'stopping', 'reconnecting'].includes(output.state));
  }

  requiresRefresh() {
    const verification = this.scenePreview.status().verification || {};
    const output = this.scenePreview.status().bilibili || {};
    const network = this.scenePreview.status().network || {};
    return verification.state === 'degraded' || verification.state === 'stale' || network.lastResult === 'degraded' || Boolean(verification.lastError || output.lastError || this.lastError);
  }

  isWindowOpen(windows, timeZone) {
    if (!windows.length) return false;
    const now = new Date(this.now());
    const dayName = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days.indexOf(dayName);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const minutes = Number(parts.find((part) => part.type === 'hour').value) * 60 + Number(parts.find((part) => part.type === 'minute').value);
    const toMinutes = (text) => {
      const [hour, minute] = text.split(':').map(Number);
      return hour * 60 + minute;
    };
    return windows.some((window) => {
      if (!window.days.includes(day)) return false;
      const start = toMinutes(window.start);
      const end = toMinutes(window.end);
      return start === end ? true : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    });
  }

  schedule({ actor, room, scene, maxDurationMs, intentId }, reason, nextAllowedAt) {
    this.pending = { action: 'start', actor, room, scene, maxDurationMs, intentId: intentId || crypto.randomUUID(), nextAllowedAt, reason };
    this.state = 'scheduled';
    this.stopReason = reason;
    this.persist();
    return { ...this.status(), started: false, reason, nextAllowedAt };
  }

  async propose({ action, actor = 'agent', room = 'default', scene = 'desktop-main', maxDurationMs, intentId } = {}) {
    if (action === 'stop') {
      const ownedIntent = this.pending?.actor === 'agent'
        ? this.pending.intentId === intentId
        : this.lastActor === 'agent' && this.lastIntentId === intentId;
      if (actor !== 'owner' && (this.policyStore.get().autonomous === 'off' || !ownedIntent)) return { ...this.status(), started: false, reason: 'forbidden' };
      return this.stop({ actor, reason: actor === 'owner' ? 'owner' : 'agent' });
    }
    if (action !== 'start') throw new Error('unsupported stream action');
    return this.start({ actor, room, scene, maxDurationMs, intentId });
  }

  async start({ actor = 'owner', room = 'default', scene = 'desktop-main', maxDurationMs, intentId } = {}) {
    if (this.transitioning) return this.status();
    if (intentId && (this.pending?.intentId === intentId || this.lastIntentId === intentId)) {
      return { ...this.status(), reason: 'duplicate_intent', deduped: true };
    }
    const policy = this.policyStore.get();
    if (actor === 'agent' && policy.autonomous === 'off') return { ...this.status(), state: 'proposed', started: false, reason: 'autonomous_disabled' };
    if (actor === 'agent' && policy.autonomous === 'windowed' && !this.isWindowOpen(policy.windows, policy.timeZone)) return this.schedule({ actor, room, scene, maxDurationMs, intentId }, 'outside_window', this.now() + 60000);
    const cooldownUntil = this.effectiveCooldownUntil();
    if (actor === 'agent' && cooldownUntil > this.now()) return this.schedule({ actor, room, scene, maxDurationMs, intentId }, 'cooldown', cooldownUntil);
    if (!policy.allowedOutputs.includes('bilibili') || !policy.rooms.includes(room) || !policy.scenes.includes(scene)) throw new Error('room or scene not allowed');
    if (actor === 'agent' && this.requiresRefresh()) return { ...this.status(), started: false, reason: 'requires_refresh' };
    if (!this.canStart()) return { ...this.status(), started: false, reason: 'already_running_or_unavailable' };
    if (maxDurationMs !== undefined && (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1000) ) throw new Error('invalid maxDurationMs');
    const duration = Math.min(maxDurationMs || policy.maxDurationMs, policy.maxDurationMs);
    this.rollDay();
    if (this.dailyMs + duration > policy.maxDailyMs) return { ...this.status(), started: false, reason: 'daily_limit' };
    this.transitioning = true;
    this.pending = null;
    this.lastIntentId = intentId || crypto.randomUUID();
    this.lastActor = actor;
    this.room = room;
    this.scene = scene;
    this.maxDurationMs = duration;
    this.startedAt = this.now();
    this.lastStoppedAt = null;
    this.stopReason = null;
    this.lastError = null;
    this.state = 'starting';
    this.persist();
    try {
      await this.scenePreview.startBilibili();
      if (this.stopRequests.length) return this.status();
      this.startTimer();
      return this.status();
    } catch (error) {
      this.state = 'degraded';
      this.lastError = safeError(error);
      this.stopReason = 'start_failed';
      this.lastStoppedAt = this.now();
      this.cooldownUntil = this.now() + policy.cooldownMs;
      this.persist();
      return this.status();
    } finally {
      this.transitioning = false;
      await this.drainStopRequests();
    }
  }

  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.tickMs);
    this.timer.unref?.();
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async stop({ actor = 'owner', reason = 'owner' } = {}) {
    if (!this.transitioning) return this.performStop({ actor, reason });
    // owner 停止不能被验证或启动中的 await 吞掉；同一场停止请求合并为一次真实停止。
    this.state = 'stopping';
    this.pending = null;
    this.persist();
    const existing = this.stopRequests[0];
    if (existing) {
      if (actor === 'owner') {
        existing.actor = 'owner';
        existing.reason = reason;
      }
      return existing.promise;
    }
    const request = { actor, reason };
    request.promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });
    this.stopRequests.push(request);
    return request.promise;
  }

  async drainStopRequests() {
    const requests = this.stopRequests.splice(0);
    if (!requests.length) return;
    const request = requests.find((item) => item.actor === 'owner') || requests[0];
    try {
      const result = await this.performStop(request);
      for (const item of requests) item.resolve(result);
    } catch (error) {
      for (const item of requests) item.reject(error);
    }
  }

  async performStop({ actor = 'owner', reason = 'owner' } = {}) {
    if (this.transitioning) throw new Error('stop transition already active');
    const output = this.scenePreview.status().bilibili || { state: 'stopped' };
    if (this.state === 'stopped' && output.state === 'stopped') {
      if (actor === 'owner' && this.stopReason !== reason) {
        this.stopReason = reason;
        this.persist();
      }
      return this.status();
    }
    this.transitioning = true;
    const startedAt = this.startedAt;
    const policy = this.policyStore.get();
    try {
      this.state = 'stopping';
      await this.scenePreview.stopBilibili();
      if (startedAt) this.dailyMs += Math.max(0, this.now() - startedAt);
      this.startedAt = null;
      this.pending = null;
      this.lastStoppedAt = this.now();
      this.cooldownUntil = this.now() + policy.cooldownMs;
      this.state = 'stopped';
      this.stopReason = reason;
      this.stopTimer();
      this.persist();
    } catch (error) {
      this.state = 'degraded';
      this.lastError = safeError(error);
      this.stopReason = 'stop_failed';
      this.persist();
    } finally {
      this.transitioning = false;
      await this.drainStopRequests();
    }
    return this.status();
  }

  async tick() {
    if (this.transitioning) return this.status();
    if (this.pending && this.state === 'scheduled' && this.now() >= this.pending.nextAllowedAt) {
      const pending = this.pending;
      this.pending = null;
      const policy = this.policyStore.get();
      if (policy.autonomous === 'anytime' || this.isWindowOpen(policy.windows, policy.timeZone)) await this.start(pending);
      else {
        this.pending = { ...pending, nextAllowedAt: this.now() + 60000, reason: 'outside_window' };
        this.persist();
        return this.status();
      }
    }
    if (!['starting', 'live', 'reconnecting'].includes(this.state)) return this.status();
    const policy = this.policyStore.get();
    if (this.now() - this.startedAt >= this.maxDurationMs) return this.stop({ actor: 'system', reason: 'max_duration' });
    if (this.dailyMs + (this.now() - this.startedAt) >= policy.maxDailyMs) return this.stop({ actor: 'system', reason: 'daily_limit' });
    this.transitioning = true;
    try {
      const output = this.scenePreview.status().bilibili;
      if (output.state === 'reconnecting') {
        this.state = 'reconnecting';
      } else if (output.state === 'failed' || output.state === 'degraded') {
        this.lastError = safeError(output.lastError || 'output failed');
        if (policy.stopOnEvidenceFailure) {
          this.transitioning = false;
          return this.stop({ actor: 'system', reason: 'output_failed' });
        }
        this.state = 'degraded';
      } else {
        const verification = await this.scenePreview.verifyBilibili();
        if (this.stopRequests.length) return this.status();
        const currentOutput = this.scenePreview.status().bilibili || { state: 'stopped' };
        const freshVerification = verification.lastVerifiedAt
          && this.now() - verification.lastVerifiedAt <= (verification.ttlMs || 45000);
        if (verification.state === 'verified' && verification.verified === true
          && freshVerification && currentOutput.state === 'running') {
          this.state = 'live';
          this.lastError = verification.lastError || null;
        } else if (verification.state === 'degraded' && this.now() - this.startedAt >= policy.verificationTimeoutMs && policy.stopOnEvidenceFailure && policy.requireVerified) {
          this.lastError = safeError(verification.lastError || 'verification failed');
          this.transitioning = false;
          return this.stop({ actor: 'system', reason: 'verification_failed' });
        } else {
          this.state = currentOutput.state === 'reconnecting' ? 'reconnecting'
            : ['failed', 'degraded'].includes(currentOutput.state) ? 'degraded'
              : currentOutput.state === 'stopped' ? 'interrupted' : 'starting';
        }
      }
      this.persist();
    } catch (error) {
      this.lastError = safeError(error);
      this.state = 'degraded';
      this.persist();
    } finally {
      this.transitioning = false;
      await this.drainStopRequests();
    }
    return this.status();
  }
}
