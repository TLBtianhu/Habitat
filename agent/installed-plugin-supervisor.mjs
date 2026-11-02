// 本地插件状态监督：Control 改状态后，AgentLoop 立即停用/恢复 runtime，无需等进程重启。
export class InstalledPluginSupervisor {
  constructor({ installer, registry, onError = () => {}, pollMs = 1000 }) {
    this.installer = installer;
    this.registry = registry;
    this.onError = onError;
    this.pollMs = pollMs;
    this.known = new Map(installer.installed().map((item) => [item.id, item]));
    this.timer = null;
    this.pending = null;
  }

  reconcile() {
    if (this.pending) return this.pending;
    this.pending = this._reconcile().finally(() => { this.pending = null; });
    return this.pending;
  }

  async _reconcile() {
    const current = new Map(this.installer.installed().map((item) => [item.id, item]));
    const ids = new Set([...this.known.keys(), ...current.keys()]);
    for (const id of ids) {
      if (!this.registry.list().some((item) => item.id === id)) continue;
      const item = current.get(id);
      const shouldSuspend = !item || !item.enabled || item.revoked;
      if (shouldSuspend && !this.registry.isSuspended(id)) await this.registry.suspend(id);
      if (!shouldSuspend && this.registry.isSuspended(id)) await this.registry.resume(id);
    }
    this.known = current;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.reconcile().catch((error) => this.onError(error));
    }, this.pollMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pending;
  }
}
