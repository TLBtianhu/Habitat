// MemorySlice：core + episode + residence 的受控读取视图与显式 scope 写入。
export class MemorySlice {
  constructor({ store, episode = null, residenceId = 'system', allowCoreWrite = false }) {
    this.store = store;
    this.episode = episode;
    this.residenceId = residenceId;
    this.allowCoreWrite = allowCoreWrite;
  }

  scopes() {
    const scopes = ['core', `residence:${this.residenceId}`];
    if (this.episode?.canRead(this.residenceId)) scopes.splice(1, 0, `episode:${this.episode.id}`);
    return scopes;
  }

  _items(scope, query = '') {
    const q = String(query || '').toLowerCase();
    return this.store.list({ scope, source: this.residenceId, includePrivate: false })
      .filter((item) => !q || item.fact.toLowerCase().includes(q) || item.tags.some((tag) => tag.toLowerCase().includes(q)))
      .map((item) => ({
        ...item,
        score: item.importance * Math.exp(-(this.store.now() - item.at) / this.store.halfLifeMs),
      }));
  }

  recall(query = '', { limit = 5 } = {}) {
    return this.scopes()
      .flatMap((scope) => this._items(scope, query))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => ({
        fact: item.fact,
        scope: item.scope,
        sourceResidenceId: item.sourceResidenceId,
        score: item.score,
      }));
  }

  workingSet({ limit = 12 } = {}) { return this.recall('', { limit }); }

  remember(fact, { scope, tags = [], importance = 1, mode = 'residence', source = this.residenceId, isPrivate = false, approvedBy = null, checkpointId = null } = {}) {
    if (scope === 'core') {
      if (!this.allowCoreWrite && approvedBy !== 'owner') throw new Error('core_write_requires_owner');
      return this.store.remember(fact, {
        scope: 'core', mode: 'persistent', tags, importance, source,
        sourceResidenceId: source, private: isPrivate, visibility: 'core', approvedBy,
      });
    }
    if (scope === 'episode') {
      if (!this.episode?.canWrite(this.residenceId)) throw new Error('episode_write_not_allowed');
      return this.store.remember(fact, {
        scope: `episode:${this.episode.id}`,
        mode,
        tags,
        importance,
        source,
        sourceResidenceId: source,
        private: isPrivate,
        episodeId: this.episode.id,
        visibility: 'episode',
        checkpointId: checkpointId || this.episode.checkpointId,
      });
    }
    if (scope === 'residence') {
      return this.store.remember(fact, {
        scope: `residence:${this.residenceId}`,
        mode,
        tags,
        importance,
        source,
        sourceResidenceId: source,
        private: isPrivate,
        visibility: 'residence',
      });
    }
    throw new Error('explicit_memory_scope_required');
  }

  context({ query = '', limit = 5 } = {}) {
    return {
      core: this._items('core', query).slice(-limit).map((item) => item.fact),
      episode: this.episode?.canRead(this.residenceId) ? {
        ...this.episode.snapshot(),
        memory: this._items(`episode:${this.episode.id}`, query).slice(-limit).map((item) => item.fact),
      } : null,
      residence: this._items(`residence:${this.residenceId}`, query).slice(-limit).map((item) => item.fact),
      scopes: this.scopes(),
    };
  }
}

export class ContextAssembler {
  constructor({ store, episode = null }) {
    this.store = store;
    this.episode = episode;
  }

  assemble({ residenceId = 'system', query = '', limit = 5 } = {}) {
    return new MemorySlice({ store: this.store, episode: this.episode, residenceId }).context({ query, limit });
  }
}
