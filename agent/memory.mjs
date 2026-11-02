// 记忆分层：工作记忆（会衰减）与档案记忆；scope 默认 system，避免跨场所泄漏。
export class Memory {
  constructor({ halfLifeMs = 3600000, maxWorking = 12, store = null } = {}) {
    this.halfLifeMs = halfLifeMs;
    this.maxWorking = maxWorking;
    this.store = store;
    this.working = [];
    this.archive = [];
  }

  remember(fact, { tags = [], importance = 1, at = Date.now(), scope = 'system', sourceResidenceId = scope, mode = scope === 'system' ? 'persistent' : 'residence', source = sourceResidenceId, isPrivate = false, episodeId = null, visibility = scope === 'system' ? 'core' : 'residence', checkpointId = null } = {}) {
    if (this.store) {
      const item = this.store.remember(fact, { tags, importance, at, scope, sourceResidenceId, mode, source, private: isPrivate, episodeId, visibility, checkpointId });
      if (!item.skipped) {
        this.archive.push(item);
        if (this.archive.length > 5000) this.archive.shift();
      }
      return item;
    }
    const item = { fact, tags, importance, at, scope, sourceResidenceId };
    this.working.push(item);
    this.archive.push(item);
    if (this.working.length > 200) this.working.shift();
    if (this.archive.length > 5000) this.archive.shift();
    return item;
  }

  workingSet(now = Date.now(), { scope = 'system' } = {}) {
    if (this.store) return this.store.workingSet(now, { scope, limit: this.maxWorking });
    const scored = this.working
      .filter((m) => m.scope === scope)
      .map((m) => ({
        ...m,
        score: m.importance * Math.exp(-(now - m.at) / this.halfLifeMs),
      }));
    return scored
      .filter((m) => m.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxWorking)
      .map((m) => m.fact);
  }

  recall(query, { limit = 5, scope = 'system' } = {}) {
    if (this.store) return this.store.recall(query, { scope, limit });
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    return this.archive
      .filter((m) => m.scope === scope)
      .filter((m) => m.fact.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)))
      .slice(-limit)
      .map((m) => m.fact);
  }
}
