// AppSession 的唯一声明式真源；obs / Desktop / Outlet 都只是它的投影。
import { AppRegistry } from '../desktop/app-registry.mjs';

export class AppSessionManager extends AppRegistry {
  open(id, { kind = 'app', view = null, ...meta } = {}) {
    return super.open(id, { ...meta, kind, view });
  }

  restart(id) {
    const current = this._must(id);
    return super.open(id, current.meta);
  }

  obs() {
    return Object.fromEntries(this.list().map((a) => [a.appId, {
      kind: a.meta?.kind || 'app',
      state: a.state,
      view: a.meta?.view || null,
      lastError: a.meta?.lastError || null,
    }]));
  }
}
