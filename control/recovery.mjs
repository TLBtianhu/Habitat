// Lifecycle recovery：记录正常/异常停止，恢复时只核对持久化事实，不重放副作用。
import fs from 'node:fs';
import path from 'node:path';
import { EpisodeStore } from '../agent/episode-store.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';
import { SkillLibrary } from '../agent/skill-library.mjs';
import { ActionTracker } from '../agent/action-tracker.mjs';

export class RecoveryManager {
  constructor({ file = process.env.HABITAT_LIFECYCLE_FILE || '/var/lib/habitat/lifecycle.json', episodeStore = null, afterAction = null, skillLibrary = null, streamStatus = null } = {}) {
    this.file = file;
    this.episodeStore = episodeStore;
    this.afterAction = afterAction;
    this.skillLibrary = skillLibrary;
    this.streamStatus = streamStatus;
  }

  _stores() {
    if (!this.episodeStore) this.episodeStore = new EpisodeStore({ root: process.env.HABITAT_EPISODE_DIR || '/var/lib/habitat/episodes' });
    if (!this.afterAction) this.afterAction = new AfterActionStore({ file: process.env.HABITAT_AFTER_ACTION_FILE || '/var/lib/habitat/after-action.jsonl' });
    if (!this.skillLibrary) this.skillLibrary = new SkillLibrary({ file: process.env.HABITAT_SKILL_LIBRARY || '/var/lib/habitat/skill-library.json' });
    return { episodeStore: this.episodeStore, afterAction: this.afterAction, skillLibrary: this.skillLibrary };
  }

  _read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return { schemaVersion: 1, bootId: 0, state: 'unknown', recoveryRequired: false }; }
  }

  _write(record) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      const owner = fs.statSync(path.dirname(this.file));
      fs.chownSync(this.file, owner.uid, owner.gid);
    }
    return record;
  }

  _pending() {
    const episode = this._stores().episodeStore.get(process.env.HABITAT_EPISODE_ID || 'live-current');
    const counts = {};
    for (const write of episode?.pendingWrites || []) {
      if (!['pending', 'unknown', 'partial'].includes(write.status)) continue;
      counts[write.status] = (counts[write.status] || 0) + 1;
    }
    return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  }

  status() {
    const record = this._read();
    const pending = this._pending();
    const stream = this.streamStatus?.() || null;
    const streamAttention = stream?.state === 'interrupted' || stream?.state === 'degraded'
      || ['starting', 'running', 'stopping', 'reconnecting'].includes(stream?.output?.state);
    return {
      state: record.state,
      bootId: record.bootId || 0,
      startedAt: record.startedAt || null,
      readyAt: record.readyAt || null,
      lastCleanShutdownAt: record.lastCleanShutdownAt || null,
      lastShutdownAbnormal: !!record.lastShutdownAbnormal,
      recoveryRequired: !!record.recoveryRequired || pending.total > 0 || streamAttention,
      pendingWrites: pending.counts,
      lastRecovery: record.lastRecovery || null,
      stream: stream ? {
        state: stream.state,
        outputState: stream.output?.state || 'stopped',
        live: stream.live === true,
        requiresAttention: streamAttention,
      } : null,
    };
  }

  boot() {
    const previous = this._read();
    const abnormal = ['starting', 'running', 'stopping'].includes(previous.state);
    return this._write({
      ...previous,
      bootId: (previous.bootId || 0) + 1,
      state: 'starting',
      startedAt: Date.now(),
      readyAt: null,
      lastShutdownAbnormal: abnormal,
      recoveryRequired: abnormal || this._pending().total > 0,
    });
  }

  ready() {
    const record = this._read();
    return this._write({ ...record, state: 'running', readyAt: Date.now() });
  }

  stopping() {
    const record = this._read();
    return this._write({ ...record, state: 'stopping' });
  }

  stopped() {
    const record = this._read();
    return this._write({ ...record, state: 'stopped', lastCleanShutdownAt: Date.now(), lastShutdownAbnormal: false });
  }

  recover() {
    const before = this._pending();
    const episode = this._stores().episodeStore.get(process.env.HABITAT_EPISODE_ID || 'live-current');
    if (!episode) return this._write({
      ...this._read(),
      recoveryRequired: this._pending().total > 0,
      lastRecovery: { at: Date.now(), changed: 0, reason: 'no_episode' },
    });
    const tracker = new ActionTracker({
      episode,
      episodeStore: this.episodeStore,
      afterAction: this.afterAction,
      skillLibrary: this.skillLibrary,
    });
    // stream 证据由 Agent 单一写入者核对；Control 只消费已有报告，不并发验证或学习开播技能。
    tracker.register('stream.propose',
      async () => [{ name: 'agent_reconcile_required', ok: null, evidence: 'deferred_to_agent_single_writer' }],
      () => ({}),
      { recordSkill: false, allowDuplicateRun: false });
    return tracker.reconcile({ minIntervalMs: 0 }).then((changed) => {
      const record = this._read();
      return this._write({
        ...record,
        recoveryRequired: this._pending().total > 0,
        lastRecovery: { at: Date.now(), changed, pendingBefore: before.total, pendingAfter: this._pending().total },
      });
    });
  }
}
