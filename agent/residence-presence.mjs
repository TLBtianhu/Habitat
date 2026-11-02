// 分场所 Presence：每个 residence 独立健康，聚合只表示整体可用性，不混成“唯一在线状态”。
export class ResidencePresence {
  constructor() { this.states = new Map(); }

  update(residenceId, patch) {
    const previous = this.states.get(residenceId) || {};
    const next = { ...previous, ...patch, residenceId, updatedAt: Date.now() };
    this.states.set(residenceId, next);
    return next;
  }

  get(residenceId) { return this.states.get(residenceId) || null; }
  list() { return [...this.states.values()].sort((a, b) => a.residenceId.localeCompare(b.residenceId)); }

  aggregate() {
    const enabled = this.list().filter((s) => s.enabled !== false);
    if (!enabled.length) return 'unknown';
    const online = enabled.filter((s) => s.state === 'online').length;
    if (online === enabled.length) return 'ready';
    if (online > 0) return 'degraded';
    return 'offline';
  }

  snapshot() {
    return { aggregate: this.aggregate(), residences: this.list() };
  }
}
