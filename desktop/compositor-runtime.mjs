// Desktop Compositor：按需连接 Surface，以共享帧泵服务多个 CaptureSession。
import crypto from 'node:crypto';
import { compose } from './compositor.mjs';
import { readSessionSnapshot } from './session-store.mjs';

function failure(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function publicCapture(c, ttlMs) {
  return {
    id: c.id,
    schemaVersion: c.schemaVersion,
    revision: c.revision || 0,
    consumer: c.consumer,
    consumerApp: c.consumerApp,
    source: c.source,
    excludeSurfaces: c.excludeSurfaces,
    fps: c.fps,
    createdAt: c.createdAt,
    lastReadAt: c.lastReadAt,
    expiresAt: c.lastReadAt + ttlMs,
  };
}

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function recipeKey(c) {
  return JSON.stringify({ source: c.source, exclude: [...c.excludeSurfaces].sort() });
}

function projectCapture(plan, capture) {
  const excluded = new Set(capture.excludeSurfaces);
  let surfaces = plan.surfaces.filter((s) => !excluded.has(s.appId));
  let taskbar = plan.taskbar.filter((s) => !excluded.has(s.appId));
  let main = excluded.has(plan.main) ? null : plan.main;
  if (capture.source.kind === 'window') {
    surfaces = surfaces.filter((s) => s.appId === capture.source.id).map((s) => ({
      ...s,
      layout: { ...s.layout, space: 'full', z: 10, opacity: 1 },
    }));
    taskbar = [];
    main = surfaces.length ? capture.source.id : null;
  }
  return {
    ...plan,
    main,
    surfaces,
    taskbar,
    layers: [
      { type: 'background' },
      ...surfaces.filter((s) => s.layout.space === 'full').map((s) => ({ type: 'surface', appId: s.appId, layout: s.layout })),
      ...surfaces.filter((s) => s.layout.space === 'pip').map((s) => ({ type: 'surface', appId: s.appId, layout: s.layout })),
      { type: 'taskbar', items: taskbar },
    ],
  };
}

export class CompositorRuntime {
  constructor({
    registry,
    providers = new Map(),
    render,
    sessionFile,
    desktopId = 'desktop',
    captureTtlMs = 30000,
    logger = () => {},
  }) {
    if (!registry) throw new Error('registry required');
    if (typeof render !== 'function') throw new Error('render required');
    this.registry = registry;
    this.providers = providers instanceof Map ? providers : new Map(Object.entries(providers));
    this.render = render;
    this.sessionFile = sessionFile;
    this.desktopId = desktopId;
    this.captureTtlMs = captureTtlMs;
    this.logger = logger;
    this.captures = new Map();
    this.variants = new Map();
    this.attached = new Set();
    this.running = false;
    this.timer = null;
    this.frameSeq = 0;
    this.framesProduced = 0;
  }

  refreshSessions() {
    const snapshot = readSessionSnapshot(this.sessionFile);
    if (snapshot) this.registry.restore(snapshot);
    return this.desktopEnabled();
  }

  desktopEnabled() {
    const desktop = this.registry.list().find((s) => s.appId === this.desktopId);
    return !!desktop && desktop.state !== 'closed';
  }

  async openCapture(options = {}) {
    const fps = Math.max(1, Math.min(30, Number(options.fps || 5)));
    const source = options.source || { kind: 'display', id: 'main' };
    if (!['display', 'window'].includes(source.kind) || !source.id) {
      throw failure(400, 'source must be display or window with id');
    }
    const consumerApp = options.consumerApp || null;
    const excludeSurfaces = Array.isArray(options.excludeSurfaces)
      ? [...new Set(options.excludeSurfaces.map(String))]
      : (consumerApp ? [consumerApp] : []);
    const capture = {
      id: crypto.randomUUID(),
      captureToken: crypto.randomBytes(32).toString('hex'),
      schemaVersion: 1,
      revision: 0,
      consumer: String(options.consumer || 'unknown').slice(0, 80),
      consumerApp,
      source: { kind: source.kind, id: String(source.id) },
      excludeSurfaces,
      fps,
      createdAt: Date.now(),
      lastReadAt: Date.now(),
    };
    this.captures.set(capture.id, capture);
    this.refreshSessions();
    await this.reconcile();
    this.logger('capture open', capture.id, capture.consumer);
    return { ...publicCapture(capture, this.captureTtlMs), captureToken: capture.captureToken };
  }

  async closeCapture(id, token = null) {
    const capture = this.getCapture(id);
    if (!sameToken(token, capture.captureToken)) throw failure(403, 'capture token required');
    this.captures.delete(id);
    const key = recipeKey(capture);
    if (![...this.captures.values()].some((c) => recipeKey(c) === key)) this.variants.delete(key);
    await this.reconcile();
    this.logger('capture close', id);
    return { closed: true, id };
  }

  authorizeCapture(id, token) {
    const capture = this.getCapture(id);
    if (!sameToken(token, capture.captureToken)) throw failure(403, 'capture token required');
    if (Date.now() - capture.lastReadAt > this.captureTtlMs) {
      this.captures.delete(id);
      this.reconcile();
      throw failure(410, 'capture expired');
    }
    return capture;
  }

  getCapture(id) {
    const capture = this.captures.get(id);
    if (!capture) throw failure(404, 'capture not found');
    return capture;
  }

  getCaptureFrame(id, token = null) {
    const capture = this.authorizeCapture(id, token);
    if (!this.desktopEnabled()) throw failure(409, 'desktop is closed');
    const frame = this.variants.get(recipeKey(capture));
    if (!frame) throw failure(202, 'frame not ready');
    capture.lastReadAt = Date.now();
    capture.revision = frame.seq;
    return frame;
  }

  listCaptures() {
    return [...this.captures.values()].map((c) => publicCapture(c, this.captureTtlMs));
  }

  describe() {
    const plan = compose(this.registry, null, { exclude: [this.desktopId] });
    return {
      appId: this.desktopId,
      enabled: this.desktopEnabled(),
      producing: this.running,
      framesProduced: this.framesProduced,
      frameSeq: this.frameSeq,
      captures: this.listCaptures(),
      surfaces: plan.surfaces.map((s) => ({ appId: s.appId, kind: s.kind, state: s.state, layout: s.layout })),
      providers: Object.fromEntries([...this.providers.entries()].map(([id, p]) => [id, p.describe?.() || { attached: this.attached.has(id) }])),
    };
  }

  visibleSurfaces() {
    return compose(this.registry, null, { exclude: [this.desktopId] }).surfaces
      .filter((s) => s.layout.space !== 'hidden' && s.state !== 'closed');
  }

  async syncProviders(surfaces) {
    const needed = new Set();
    for (const surface of surfaces) {
      const provider = this.providers.get(surface.appId);
      if (!provider) continue;
      needed.add(surface.appId);
      if (!this.attached.has(surface.appId)) {
        await provider.attachSurface?.({ appId: surface.appId, surface });
        this.attached.add(surface.appId);
        this.logger('surface attach', surface.appId);
      }
    }
    for (const appId of [...this.attached]) {
      if (needed.has(appId)) continue;
      const provider = this.providers.get(appId);
      await provider?.detachSurface?.({ appId });
      this.attached.delete(appId);
      this.logger('surface detach', appId);
    }
  }

  async produceOnce() {
    const now = Date.now();
    for (const capture of [...this.captures.values()]) {
      if (now - capture.lastReadAt > this.captureTtlMs) {
        this.captures.delete(capture.id);
        this.logger('capture expired', capture.id);
      }
    }
    if (!this.captures.size) { this.stopProduction(); return; }

    const surfaces = this.visibleSurfaces();
    await this.syncProviders(surfaces);
    const inputs = new Map();
    for (const surface of surfaces) {
      const provider = this.providers.get(surface.appId);
      if (!provider || !this.attached.has(surface.appId)) continue;
      const input = await provider.pullFrame({ appId: surface.appId, surface });
      if (input) inputs.set(surface.appId, input);
    }
    const base = compose(this.registry, inputs, { exclude: [this.desktopId] });
    const recipes = new Map();
    for (const capture of this.captures.values()) {
      const key = recipeKey(capture);
      if (!recipes.has(key)) recipes.set(key, capture);
    }
    for (const [key, capture] of recipes) {
      const rendered = await this.render(projectCapture(base, capture), capture);
      const data = Buffer.isBuffer(rendered) ? rendered : rendered.data;
      const mime = Buffer.isBuffer(rendered) ? 'image/png' : (rendered.mime || 'image/png');
      this.variants.set(key, { data, mime, seq: ++this.frameSeq, at: Date.now() });
      this.framesProduced += 1;
    }
  }

  async reconcile() {
    const shouldProduce = this.desktopEnabled() && this.captures.size > 0;
    if (!shouldProduce) { this.stopProduction(); return; }
    if (this.running) return;
    this.running = true;
    this.logger('frame pump start');
    this.timer = setTimeout(() => this.pump(), 0);
  }

  async pump() {
    if (!this.running) return;
    try {
      const enabled = this.refreshSessions();
      if (!enabled || !this.captures.size) this.stopProduction();
      else await this.produceOnce();
    } catch (e) {
      this.logger('frame pump error', e.message);
    } finally {
      if (this.running) {
        const fps = Math.max(...[...this.captures.values()].map((c) => c.fps), 1);
        this.timer = setTimeout(() => this.pump(), Math.round(1000 / fps));
      }
    }
  }

  stopProduction() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wasRunning = this.running;
    this.running = false;
    this.variants.clear();
    for (const appId of [...this.attached]) {
      const provider = this.providers.get(appId);
      Promise.resolve(provider?.detachSurface?.({ appId })).catch(() => {});
      this.attached.delete(appId);
    }
    if (wasRunning) this.logger('frame pump stop');
  }

  close() {
    this.stopProduction();
    this.captures.clear();
  }
}
