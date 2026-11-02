// AppRegistry：应用生命周期的唯一真源。DSH 只看这里，不看 Surface。
export const AppState = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  BACKGROUND: 'background',
  FOCUSED: 'focused',
});

export class AppRegistry {
  constructor() {
    this.sessions = new Map();
    this.events = [];
  }

  _emit(type, appId, data = {}) {
    this.events.push({ type, appId, at: Date.now(), ...data });
    if (this.events.length > 200) this.events.shift();
  }

  open(appId, meta = {}) {
    if (!appId) throw new Error('appId required');
    const prev = this.sessions.get(appId);
    const session = {
      appId,
      state: prev?.state === AppState.FOCUSED ? AppState.FOCUSED : AppState.OPEN,
      meta: { ...(prev?.meta || {}), ...meta },
      openedAt: prev?.openedAt || Date.now(),
      lastEventAt: Date.now(),
    };
    this.sessions.set(appId, session);
    this._emit('app.open', appId);
    return session;
  }

  focus(appId) {
    const s = this._must(appId);
    for (const other of this.sessions.values()) {
      if (other.appId !== appId && other.state === AppState.FOCUSED) other.state = AppState.BACKGROUND;
    }
    s.state = AppState.FOCUSED;
    s.lastEventAt = Date.now();
    this._emit('app.focus', appId);
    return s;
  }

  background(appId) {
    const s = this._must(appId);
    if (s.state !== AppState.CLOSED) s.state = AppState.BACKGROUND;
    s.lastEventAt = Date.now();
    this._emit('app.background', appId);
    return s;
  }

  close(appId) {
    const s = this._must(appId);
    s.state = AppState.CLOSED;
    s.lastEventAt = Date.now();
    this._emit('app.close', appId);
    return s;
  }

  current() {
    return [...this.sessions.values()].find((s) => s.state === AppState.FOCUSED) || null;
  }

  list() {
    return [...this.sessions.values()];
  }

  snapshot() {
    return {
      at: Date.now(),
      apps: this.list().map((s) => ({ ...s, meta: { ...(s.meta || {}) } })),
    };
  }

  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.apps)) throw new Error('invalid session snapshot');
    this.sessions = new Map(snapshot.apps.map((s) => [s.appId, {
      ...s,
      meta: { ...(s.meta || {}) },
    }]));
    return this;
  }

  _must(appId) {
    const s = this.sessions.get(appId);
    if (!s) throw new Error('app not open: ' + appId);
    return s;
  }
}
