// ActionTracker：副作用前先写 pending；AfterAction 结果回写 Episode；重启只核对证据，不重放副作用。
import { verifyChecks } from './after-action.mjs';
export class ActionTracker {
  constructor({ episode, episodeStore, afterAction, skillLibrary = null, now = () => Date.now() }) {
    this.episode = episode;
    this.episodeStore = episodeStore;
    this.afterAction = afterAction;
    this.skillLibrary = skillLibrary;
    this.now = now;
    this.verifiers = new Map();
  }

  register(kind, verify, references = () => ({})) {
    this.verifiers.set(kind, { verify, references });
  }

  async track({ kind, args = {}, residenceId = 'system', run }) {
    const registration = this.verifiers.get(kind);
    if (!registration) throw new Error('action verifier not registered: ' + kind);
    const write = this.episode.addPendingWrite(kind, { args, residenceId });
    this.episodeStore.save(this.episode);
    try {
      const result = await run();
      write.data.refs = registration.references(result) || {};
      this.episodeStore.save(this.episode);
      const checks = await registration.verify(write, result);
      const report = this._finish(write, checks);
      return { result, afterAction: report };
    } catch (error) {
      const report = this._finish(write, [{ name: 'execute', ok: false, evidence: error.message }]);
      error.afterAction = report;
      throw error;
    }
  }

  _finish(write, checks) {
    const report = this.afterAction.record({
      taskId: write.id,
      residenceId: write.data.residenceId || 'system',
      goal: write.kind,
      checks,
    });
    this.episode.resolveWrite(write.id, { outcome: report.verification.outcome, reportId: report.id });
    this.episodeStore.save(this.episode);
    if (report.verification.outcome === 'verified_success') {
      this.skillLibrary?.record({ episode: this.episode, write, report });
    }
    return report;
  }

  async reconcile({ minIntervalMs = 5000 } = {}) {
    const reports = this.afterAction.list();
    let changed = 0;
    for (const write of this.episode.pendingWrites) {
      if (!['pending', 'unknown', 'partial'].includes(write.status)) continue;
      if (this.now() - (write.lastCheckedAt || write.at) < minIntervalMs) continue;
      if (write.status === 'pending') {
        const existing = reports.filter((report) => report.taskId === write.id).at(-1);
        if (existing) {
          this.episode.resolveWrite(write.id, { outcome: existing.verification.outcome, reportId: existing.id });
          this.episodeStore.save(this.episode);
          if (existing.verification.outcome === 'verified_success') this.skillLibrary?.record({ episode: this.episode, write, report: existing });
          changed++;
          continue;
        }
      }
      if (!write.data?.refs || !Object.keys(write.data.refs).length) continue;
      const registration = this.verifiers.get(write.kind);
      if (!registration) continue;
      try {
        const checks = await registration.verify(write, null);
        const outcome = verifyChecks(checks).outcome;
        if (outcome === write.outcome) {
          write.lastCheckedAt = this.now();
          this.episodeStore.save(this.episode);
          continue;
        }
        this._finish(write, checks);
        changed++;
      } catch {
        write.lastCheckedAt = this.now();
        this.episodeStore.save(this.episode);
      }
    }
    return changed;
  }
}
