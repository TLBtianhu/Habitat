// 技能运行时：artifact 注册表 + broker + 蓝绿切换 + 观察窗口自动回滚
// 身份挂在 id 上，实例只是槽；切换、调用与回滚都按技能 id 隔离。
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker-skill.mjs');

export class SkillRuntime {
  constructor({ watchMs = 200, drainMs = 100, callTimeoutMs = 1000 } = {}) {
    this.watchMs = watchMs;
    this.drainMs = drainMs;
    this.callTimeoutMs = callTimeoutMs;
    this.slots = new Map();       // slotKey -> slot
    this.live = new Map();        // id -> slotKey
    this.history = new Map();     // id -> [{artifact, state}]
    this.states = new Map();      // id -> state（挂在 id 上，不挂实例）
    this.generation = new Map();  // id -> 代数
    this.transitions = new Map(); // id -> 串行转换 Promise
    this.commandLog = [];
    this.seq = 0;
    this.slotSeq = 0;
  }

  _emit(type, data) { this.commandLog.push({ type, at: Date.now(), ...data }); }

  _newSlot(artifact, state) {
    const key = `${artifact.manifest.id}@${artifact.manifest.version}#${++this.slotSeq}`;
    const slot = {
      key, artifact, state, worker: null, alive: false, errors: 0,
      until: Date.now() + this.watchMs, rolledBack: false,
      draining: false, pending: new Map(),
    };
    const w = new Worker(WORKER);
    slot.worker = w;
    w.on('message', (m) => this._onMessage(slot, m));
    w.on('error', (e) => {
      this._rejectPending(slot, e.message);
      this._unhealthy(slot, e.message);
    });
    w.on('exit', (code) => {
      slot.alive = false;
      this._rejectPending(slot, 'worker_exit:' + code);
      if (!slot.draining) this._unhealthy(slot, 'exit:' + code);
    });
    this.slots.set(key, slot);
    return slot;
  }

  _onMessage(slot, m) {
    if (m.type !== 'result') return;
    const pending = slot.pending.get(m.id);
    if (!pending) {
      this._emit('call:late', { id: slot.artifact.manifest.id, callId: m.id, slotKey: slot.key });
      return;
    }
    clearTimeout(pending.timer);
    slot.pending.delete(m.id);
    this._emit('call', { id: pending.skillId, capability: pending.capability, ok: m.ok });
    pending.resolve(m);
  }

  _rejectPending(slot, error) {
    for (const [callId, pending] of slot.pending) {
      clearTimeout(pending.timer);
      this._emit('call:error', { id: pending.skillId, callId, error });
      pending.resolve({ ok: false, error });
    }
    slot.pending.clear();
  }

  _init(slot) {
    return new Promise((resolve) => {
      const onMsg = (m) => {
        if (m.type !== 'ready') return;
        clearTimeout(timer);
        slot.worker.off('message', onMsg);
        slot.alive = m.ok;
        resolve(m);
      };
      const timer = setTimeout(() => {
        slot.worker.off('message', onMsg);
        resolve({ ok: false, error: 'init timeout' });
      }, this.callTimeoutMs * 4);
      slot.worker.on('message', onMsg);
      slot.worker.postMessage({ type: 'init', artifact: slot.artifact, state: slot.state });
    });
  }

  _transition(id, fn) {
    const previous = this.transitions.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.transitions.set(id, run);
    return run.finally(() => {
      if (this.transitions.get(id) === run) this.transitions.delete(id);
    });
  }

  async activate(artifact) {
    const id = artifact.manifest?.id;
    if (!id) throw new Error('manifest.id required');
    return this._transition(id, () => this._activate(artifact));
  }

  async _activate(artifact) {
    const id = artifact.manifest.id;
    const prevKey = this.live.get(id);
    const prev = prevKey ? this.slots.get(prevKey) : null;
    const slot = this._newSlot(artifact, this.states.get(id) || {});
    const ready = await this._init(slot);
    if (!ready.ok) {
      this._rejectPending(slot, ready.error || 'activate failed');
      try { await slot.worker.terminate(); } catch {}
      this.slots.delete(slot.key);
      this._emit('activate:reject', { id, error: ready.error });
      throw new Error('activate failed: ' + ready.error);
    }

    if (prev) {
      this.history.set(id, [...(this.history.get(id) || []), { artifact: prev.artifact, state: prev.state }]);
      await this._drain(prev);
    }
    this.live.set(id, slot.key);
    slot.until = Date.now() + this.watchMs;
    this._collectGarbage(slot.key);
    this.generation.set(id, (this.generation.get(id) || 0) + 1);
    this._emit('activate', { id, version: artifact.manifest.version, generation: this.generation.get(id) });
    return slot.key;
  }

  async _drain(slot) {
    slot.draining = true;
    this._rejectPending(slot, 'draining');
    if (!slot.alive) {
      this.slots.delete(slot.key);
      try { await slot.worker.terminate(); } catch {}
      return;
    }
    slot.alive = false;
    const bye = new Promise((r) => slot.worker.once('message', (m) => { if (m.type === 'bye') r(); }));
    slot.worker.postMessage({ type: 'shutdown' });
    await Promise.race([bye, new Promise((r) => setTimeout(r, this.drainMs))]);
    await slot.worker.terminate();
    this.slots.delete(slot.key);
  }

  _collectGarbage(exceptKey) {
    const exceptId = this.slots.get(exceptKey)?.artifact.manifest.id;
    // 只回收同一技能的旧槽，其他技能的活槽绝不能被切换误杀。
    for (const [key, slot] of this.slots) {
      if (key === exceptKey || slot.artifact.manifest.id !== exceptId) continue;
      slot.draining = true;
      this._rejectPending(slot, 'superseded');
      try { slot.worker.terminate(); } catch {}
      this.slots.delete(key);
    }
  }

  _unhealthy(slot, reason) {
    if (slot.draining || slot.rolledBack) return;
    slot.rolledBack = true;
    const id = slot.artifact.manifest.id;
    if (this.live.get(id) !== slot.key) return;
    if (this.transitions.has(id)) {
      this._emit('unhealthy:ignored_transition', { id, reason, slotKey: slot.key });
      return;
    }
    if (Date.now() > slot.until) this._emit('unhealthy', { id, reason, afterWatch: true });
    this.rollback(id, reason).catch((e) => this._emit('rollback:fail', { id, error: e.message }));
  }

  async rollback(id, reason = 'manual') {
    return this._transition(id, () => this._rollback(id, reason));
  }

  async _rollback(id, reason) {
    const hist = (this.history.get(id) || []).pop();
    if (!hist) {
      this._emit('rollback:empty', { id, reason });
      return null;
    }
    const oldKey = this.live.get(id);
    if (oldKey && this.slots.has(oldKey)) await this._drain(this.slots.get(oldKey));

    this.states.set(id, hist.state);
    const slot = this._newSlot(hist.artifact, hist.state);
    const ready = await this._init(slot);
    if (!ready.ok) {
      this._rejectPending(slot, ready.error || 'rollback failed');
      try { await slot.worker.terminate(); } catch {}
      this.slots.delete(slot.key);
      if (this.live.get(id) === oldKey) this.live.delete(id);
      this._emit('rollback:fail', { id, error: ready.error });
      return null;
    }
    this.live.set(id, slot.key);
    slot.until = Date.now() + this.watchMs;
    this._collectGarbage(slot.key);
    this.generation.set(id, (this.generation.get(id) || 0) + 1);
    this._emit('rollback', { id, reason, to: hist.artifact.manifest.version, generation: this.generation.get(id) });
    return slot.key;
  }

  async call(id, capability, args = {}) {
    const key = this.live.get(id);
    const slot = key && this.slots.get(key);
    if (!slot || !slot.alive || slot.draining) return { ok: false, error: 'no live slot' };
    const caps = slot.artifact.manifest.capabilities || [];
    if (!caps.includes(capability)) {
      this._emit('capability_denied', { id, capability });
      return { ok: false, error: 'capability_denied: ' + capability };
    }
    const callId = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = slot.pending.get(callId);
        if (!pending) return;
        slot.pending.delete(callId);
        this._emit('call:timeout', { id, capability, callId });
        resolve({ ok: false, error: 'timeout' });
      }, this.callTimeoutMs);
      slot.pending.set(callId, { resolve, timer, skillId: id, capability });
      slot.worker.postMessage({ type: 'call', id: callId, capability, args });
    });
  }

  async dispose() {
    for (const slot of this.slots.values()) {
      slot.draining = true;
      this._rejectPending(slot, 'disposed');
      try { await slot.worker.terminate(); } catch {}
    }
    this.slots.clear();
    this.live.clear();
    this.transitions.clear();
  }
}

export function makeArtifact(id, version, code, capabilities = []) {
  return { manifest: { id, version, entry: 'index.mjs', capabilities, stateSchema: 1 }, code };
}
