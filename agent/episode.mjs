// Episode：跨 residence 的当前任务状态、参与者、checkpoint 与 pending writes。
import crypto from 'node:crypto';

const ACTIVE = new Set(['active', 'paused']);
const ENDED = new Set(['completed', 'failed', 'cancelled']);
export class Episode {
  constructor(data) {
    this.id = data.id;
    this.goal = String(data.goal || '');
    this.participants = [...new Set(data.participants || [])];
    this.phase = data.phase || 'BOOT';
    this.status = data.status || 'active';
    this.visibility = data.visibility || 'participants';
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || this.createdAt;
    this.checkpointId = data.checkpointId || null;
    this.checkpoint = data.checkpoint || null;
    this.pendingWrites = (data.pendingWrites || []).slice(-50);
    if (!this.id || !this.goal) throw new Error('episode id and goal required');
    if (!['active', 'paused', 'completed', 'failed', 'cancelled'].includes(this.status)) throw new Error('invalid episode status');
  }

  static create({ id = crypto.randomUUID(), goal, participants = [], phase = 'BOOT', visibility = 'participants' }) {
    return new Episode({ id, goal, participants, phase, visibility });
  }

  touch() { this.updatedAt = Date.now(); }
  isActive() { return this.status === 'active'; }
  isEnded() { return ENDED.has(this.status); }
  canRead(residenceId) { return this.visibility === 'public' || this.participants.includes(residenceId); }
  canWrite(residenceId) { return this.isActive() && this.canRead(residenceId); }

  addParticipant(residenceId) {
    if (!this.participants.includes(residenceId)) {
      this.participants.push(residenceId);
      this.touch();
    }
  }

  checkpointState(data) {
    if (this.isEnded()) throw new Error('episode ended');
    this.checkpoint = { ...(this.checkpoint || {}), ...data };
    this.checkpointId = crypto.randomUUID();
    if (data.phase) this.phase = data.phase;
    this.touch();
    return this.checkpoint;
  }

  pause() { if (this.status === 'active') { this.status = 'paused'; this.touch(); } return this.status; }
  resume() { if (this.status === 'paused') { this.status = 'active'; this.touch(); } return this.status; }
  complete() { if (ACTIVE.has(this.status)) { this.status = 'completed'; this.touch(); } return this.status; }
  fail() { if (ACTIVE.has(this.status)) { this.status = 'failed'; this.touch(); } return this.status; }
  cancel() { if (ACTIVE.has(this.status)) { this.status = 'cancelled'; this.touch(); } return this.status; }

  addPendingWrite(kind, data = null) {
    if (!this.isActive()) throw new Error('episode not active');
    const write = { id: crypto.randomUUID(), kind, data, at: Date.now(), status: 'pending' };
    this.pendingWrites.push(write);
    this.pendingWrites = this.pendingWrites.slice(-50);
    this.touch();
    return write;
  }

  confirmWrite(id, outcome) {
    const write = this.pendingWrites.find((w) => w.id === id);
    if (!write) throw new Error('pending write not found');
    write.status = 'confirmed';
    write.outcome = outcome;
    write.confirmedAt = Date.now();
    this.touch();
    return write;
  }

  resolveWrite(id, { outcome, reportId = null }) {
    const write = this.pendingWrites.find((w) => w.id === id);
    if (!write) throw new Error('pending write not found');
    const status = {
      verified_success: 'confirmed',
      verified_failure: 'failed',
      verified_partial: 'partial',
      unknown: 'unknown',
    }[outcome];
    if (!status) throw new Error('invalid write outcome');
    write.status = status;
    write.outcome = outcome;
    write.reportId = reportId;
    write.resolvedAt = Date.now();
    write.lastCheckedAt = write.resolvedAt;
    if (status === 'confirmed') write.confirmedAt = write.resolvedAt;
    this.touch();
    return write;
  }

  snapshot() {
    return {
      id: this.id,
      goal: this.goal,
      participants: [...this.participants],
      phase: this.phase,
      status: this.status,
      visibility: this.visibility,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      checkpointId: this.checkpointId,
      checkpoint: this.checkpoint,
      pendingWrites: this.pendingWrites.map((w) => ({ ...w })),
    };
  }
}
