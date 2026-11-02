// Director 模式机：合法转换 + transitionId + 外部副作用确认/补偿。
// 本地相位回滚不等于外部一致；补偿失败必须留在可重建、可对账的状态。
export const Phase = Object.freeze({
  BOOT: 'BOOT', OFFLINE: 'OFFLINE', IDLE: 'IDLE', PLAY: 'PLAY',
  CODE: 'CODE', VERIFY: 'VERIFY', DEGRADED: 'DEGRADED', ENDING: 'ENDING',
});

const WRITABLE = new Set([Phase.PLAY, Phase.VERIFY]);
const ALL = new Set(Object.values(Phase));
const EDGES = Object.freeze({
  BOOT: [Phase.IDLE, Phase.PLAY, Phase.OFFLINE, Phase.DEGRADED],
  OFFLINE: [Phase.IDLE, Phase.PLAY, Phase.DEGRADED, Phase.ENDING],
  IDLE: [Phase.PLAY, Phase.OFFLINE, Phase.DEGRADED, Phase.ENDING],
  PLAY: [Phase.IDLE, Phase.CODE, Phase.VERIFY, Phase.OFFLINE, Phase.DEGRADED, Phase.ENDING],
  CODE: [Phase.PLAY, Phase.VERIFY, Phase.DEGRADED, Phase.ENDING],
  VERIFY: [Phase.PLAY, Phase.CODE, Phase.DEGRADED, Phase.ENDING],
  DEGRADED: [],
  ENDING: [Phase.OFFLINE],
});

function effectError(adapter, action, cause) {
  const e = new Error(`${adapter}.${action} failed: ${cause}`);
  e.adapter = adapter;
  e.action = action;
  return e;
}
function rejected(value) {
  return value === false || value?.confirmed === false || value?.ok === false;
}
function confirmedCancel(value) {
  return value === true || value?.confirmed === true || value?.ok === true;
}

export class PhaseMachine {
  constructor(adapters = {}) {
    this.adapters = adapters;
    this.clock = adapters.clock || (() => Date.now());
    this.phase = Phase.BOOT;
    this.lastStablePhase = Phase.IDLE;
    this.status = {
      streaming: false,
      visible: true,
      controller: 'agent',
      scene: 'standby',
      degraded: null,
    };
    this.session = null;
    this.log = [];
    this.effects = [];
    this.pendingReconciliation = [];
    this.listeners = new Set();
    this.transitionSeq = 0;
    this.transitionQueue = Promise.resolve();
    this.queuedTransitions = 0;
    this.activeTransition = null;
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(type, data = {}) {
    const rec = { type, at: this.clock(), phase: this.phase, ...data };
    this.log.push(rec);
    if (this.log.length > 500) this.log.shift();
    for (const fn of this.listeners) fn(rec);
    return rec;
  }

  canAct() {
    if (this.pendingReconciliation.length) return { ok: false, reason: 'reconciliation_required' };
    if (this.activeTransition || this.queuedTransitions > 0) return { ok: false, reason: 'transition_in_progress' };
    if (this.status.controller !== 'agent') return { ok: false, reason: 'human_control' };
    if (this.phase === Phase.DEGRADED) return { ok: false, reason: 'degraded' };
    return { ok: true };
  }

  canWriteWorld() {
    if (!WRITABLE.has(this.phase)) return { ok: false, reason: 'wrong_phase' };
    return this.canAct();
  }

  canTransition(from, to) {
    if (from === Phase.DEGRADED) return to === this.lastStablePhase;
    return EDGES[from]?.includes(to) || false;
  }

  async to(next, why = '') {
    this.queuedTransitions += 1;
    const run = this.transitionQueue.catch(() => {}).then(() => this._to(next, why))
      .finally(() => { this.queuedTransitions -= 1; });
    this.transitionQueue = run;
    return run;
  }

  async _to(next, why) {
    if (!ALL.has(next)) throw new Error('unknown phase: ' + next);
    if (next === this.phase) return this.phase;
    const transitionId = ++this.transitionSeq;
    const from = this.phase;
    if (this.pendingReconciliation.length) {
      this.emit('phase:reject', { transitionId, from, to: next, error: 'reconciliation_required' });
      throw new Error('reconciliation required before new transition');
    }
    if (!this.canTransition(from, next)) {
      this.emit('phase:reject', { transitionId, from, to: next, error: `illegal_transition:${from}->${next}` });
      throw new Error(`illegal transition: ${from} -> ${next}`);
    }

    const prevStatus = { ...this.status };
    const ctx = { transitionId, from, to: next, why };
    this.activeTransition = ctx;
    this.emit('phase:start', { transitionId, from, to: next, why });
    try {
      if (next === Phase.CODE) await this.enterCode(ctx);
      if (from === Phase.CODE && next !== Phase.CODE) await this.leaveCode(ctx);
      if (next === Phase.ENDING) await this.doEnding(ctx);

      this.phase = next;
      if (next !== Phase.DEGRADED && next !== Phase.BOOT) this.lastStablePhase = next;
      this.status.degraded = next === Phase.DEGRADED ? (why || 'unspecified') : null;
      this.emit('phase', { transitionId, from, to: next, why });
      return this.phase;
    } catch (e) {
      this.phase = from;
      this.status = prevStatus;
      this.emit('phase:abort', {
        transitionId, from, to: next,
        error: String(e.message || e),
        compensationErrors: (e.compensationErrors || []).map((x) => x.error),
      });
      throw e;
    } finally {
      this.activeTransition = null;
    }
  }

  _record(ctx, adapter, action, outcome, compensating = false) {
    const rec = { transitionId: ctx.transitionId, adapter, action, outcome, compensating, at: this.clock() };
    this.effects.push(rec);
    if (this.effects.length > 300) this.effects.shift();
    this.emit('effect', rec);
  }

  async _effect(adapter, action, args, ctx, { compensating = false } = {}) {
    const fn = this.adapters[adapter]?.[action];
    if (typeof fn !== 'function') return undefined;
    this._record(ctx, adapter, action, 'attempted', compensating);
    try {
      const result = await fn.apply(this.adapters[adapter], [...args, ctx]);
      if (rejected(result)) throw effectError(adapter, action, 'rejected');
      this._record(ctx, adapter, action, 'confirmed', compensating);
      return result;
    } catch (e) {
      this._record(ctx, adapter, action, 'uncertain', compensating);
      if (e.adapter) throw e;
      throw effectError(adapter, action, String(e.message || e));
    }
  }

  async _plan(steps, ctx) {
    const attempted = [];
    try {
      for (const step of steps) {
        if (step.undo) attempted.push(step);
        await this._effect(step.adapter, step.action, step.args || [], ctx);
      }
    } catch (error) {
      const compensationErrors = [];
      for (const step of attempted.reverse()) {
        try {
          await this._effect(step.undo.adapter, step.undo.action, step.undo.args || [], ctx, { compensating: true });
        } catch (e) {
          const failure = {
            transitionId: ctx.transitionId,
            adapter: step.undo.adapter,
            action: step.undo.action,
            args: step.undo.args || [],
            error: String(e.message || e),
          };
          compensationErrors.push(failure);
          this.pendingReconciliation.push(failure);
          this.emit('phase:compensation_failed', failure);
        }
      }
      error.compensationErrors = compensationErrors;
      throw error;
    }
  }

  async enterCode(ctx) {
    await this.quiesce(3000, ctx);
    await this._plan([
      { adapter: 'world', action: 'saveState', args: [] },
      { adapter: 'world', action: 'park', args: [], undo: { adapter: 'world', action: 'resume', args: [] } },
      {
        adapter: 'presenter', action: 'setScene', args: ['code'],
        undo: { adapter: 'presenter', action: 'setScene', args: [this.status.scene || 'standby'] },
      },
    ], ctx);
    this.emit('code:ready', { transitionId: ctx.transitionId });
  }

  async leaveCode(ctx) {
    await this._plan([
      { adapter: 'world', action: 'resume', args: [], undo: { adapter: 'world', action: 'park', args: [] } },
      {
        adapter: 'presenter', action: 'setScene', args: ['world'],
        undo: { adapter: 'presenter', action: 'setScene', args: ['code'] },
      },
    ], ctx);
    this.emit('code:leave', { transitionId: ctx.transitionId });
  }

  async quiesce(timeoutMs = 3000, ctx = { transitionId: null, from: this.phase, to: this.phase }) {
    const t0 = this.clock();
    this.emit('quiesce:start', { transitionId: ctx.transitionId });
    const drain = this.adapters.world?.drain;
    if (typeof drain !== 'function') {
      this.emit('quiesce:done', { transitionId: ctx.transitionId, afterMs: this.clock() - t0 });
      return;
    }

    this._record(ctx, 'world', 'drain', 'attempted');
    let drainPromise;
    try {
      drainPromise = drain.call(this.adapters.world, timeoutMs, ctx);
    } catch (e) {
      this._record(ctx, 'world', 'drain', 'uncertain');
      throw e;
    }
    if (!drainPromise || typeof drainPromise.then !== 'function') {
      this._record(ctx, 'world', 'drain', 'confirmed');
      this.emit('quiesce:done', { transitionId: ctx.transitionId, afterMs: this.clock() - t0 });
      return;
    }

    let late = false;
    drainPromise.then(
      () => {
        if (!late) return;
        this._record(ctx, 'world', 'drain', 'late_confirmed');
        this.emit('quiesce:late', { transitionId: ctx.transitionId });
      },
      () => {},
    );
    const result = await Promise.race([
      drainPromise,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);
    if (result !== 'timeout') {
      this._record(ctx, 'world', 'drain', 'confirmed');
      this.emit('quiesce:done', { transitionId: ctx.transitionId, afterMs: this.clock() - t0 });
      return;
    }

    late = true;
    this._record(ctx, 'world', 'drain', 'uncertain');
    const cancel = await this._effect('world', 'cancelInflight', [], ctx);
    if (!confirmedCancel(cancel)) {
      const e = effectError('world', 'quiesce', 'cancel_unconfirmed');
      this.emit('quiesce:failed', { transitionId: ctx.transitionId, error: 'cancel_unconfirmed' });
      throw e;
    }
    this._record(ctx, 'world', 'drain', 'cancelled');
    this.emit('quiesce:cancelled', { transitionId: ctx.transitionId, afterMs: this.clock() - t0 });
    this.emit('quiesce:done', { transitionId: ctx.transitionId, afterMs: this.clock() - t0, cancelled: true });
  }

  async reconcile() {
    const run = this.transitionQueue.catch(() => {}).then(async () => {
      const pending = [...this.pendingReconciliation];
      this.pendingReconciliation = [];
      const failed = [];
      for (const item of pending) {
        try {
          await this._effect(item.adapter, item.action, item.args, {
            transitionId: item.transitionId, from: this.phase, to: this.phase, reconciling: true,
          }, { compensating: true });
        } catch (e) {
          failed.push({ ...item, error: String(e.message || e) });
        }
      }
      this.pendingReconciliation = failed;
      if (failed.length) throw new Error('reconciliation failed: ' + failed.map((f) => f.error).join('; '));
      this.emit('reconcile:done');
      return true;
    });
    this.transitionQueue = run;
    return run;
  }

  canEnd({ promisesCleared, goalDone, idleDensity = 0, durationMin = 0, hardTask = false }) {
    if (hardTask) return false;
    if (durationMin < 20) return false;
    if (durationMin >= 360) return true;
    return promisesCleared && (goalDone || idleDensity < 0.2);
  }

  async doEnding(ctx) {
    if (!this.session) throw new Error('ENDING 需要 session.json（没有交接就没有下一场）');
    await this._plan([
      { adapter: 'recorder', action: 'writeSession', args: [this.session] },
      {
        adapter: 'presenter', action: 'setScene', args: ['ending'],
        undo: { adapter: 'presenter', action: 'setScene', args: [this.status.scene || 'standby'] },
      },
    ], ctx);
    this.emit('ending:handoff', { transitionId: ctx.transitionId, session: this.session });
  }

  setHandoff(session) { this.session = session; }

  setController(who) {
    if (who !== 'agent' && who !== 'human') throw new Error('bad controller');
    this.status.controller = who;
    this.emit('controller', { who });
  }

  snapshot() {
    return {
      phase: this.phase,
      lastStablePhase: this.lastStablePhase,
      status: { ...this.status },
      session: this.session,
      activeTransition: this.activeTransition,
      pendingReconciliation: this.pendingReconciliation.map((x) => ({ ...x })),
      effects: this.effects.slice(-100).map((x) => ({ ...x })),
    };
  }
}

export function createDirector(adapters) {
  return new PhaseMachine(adapters);
}
