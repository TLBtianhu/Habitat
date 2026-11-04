// SceneRecorder：统一 FrameClock 与 FramePacket 分发；输出端独立启停、独立失败。
export class SceneRecorder {
  constructor({ capture, outputs = {}, fps = 5 }) {
    if (!capture || typeof capture.poll !== 'function' || typeof capture.close !== 'function') throw new Error('capture required');
    if (!Number.isSafeInteger(fps) || fps < 1 || fps > 60) throw new Error('fps out of range');
    this.capture = capture;
    this.outputs = new Map(Object.entries(outputs));
    this.intervalMs = Math.max(16, Math.round(1000 / fps));
    this.state = 'stopped';
    this.startedAt = 0;
    this.lastPacket = null;
    this.lastSeq = 0;
    this.lastPtsMs = -1;
    this.framesProduced = 0;
    this.timer = null;
    this.ticking = false;
    this.outputErrors = new Map();
  }

  running() { return this.state === 'running' || this.state === 'degraded' || this.state === 'starting'; }

  status() {
    return {
      state: this.state,
      startedAt: this.startedAt || null,
      frameSeq: this.lastSeq,
      lastPtsMs: this.lastPtsMs < 0 ? null : this.lastPtsMs,
      framesProduced: this.framesProduced,
      lastError: [...this.outputErrors.values()].join('; ') || null,
      outputs: Object.fromEntries([...this.outputs.entries()].map(([name, output]) => [name, {
        ...(output.status?.() || {}),
        lastError: this.outputErrors.get(name) || output.status?.().lastError || null,
      }])),
    };
  }

  async start() {
    if (this.running()) return this.status();
    this.state = 'starting';
    this.startedAt = Date.now();
    this.lastSeq = 0;
    this.lastPtsMs = -1;
    this.framesProduced = 0;
    this.lastPacket = null;
    this.outputErrors.clear();
    try {
      await this.capture.open?.();
    } catch (error) {
      this.state = 'degraded';
      this.outputErrors.set('capture', error.message);
      throw error;
    }
    this.state = 'running';
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    this.timer.unref?.();
    await this.tick();
    return this.status();
  }

  async tick() {
    if (!this.running() || this.ticking) return;
    this.ticking = true;
    try {
      const frame = await this.capture.poll();
      if (!frame || frame.seq <= this.lastSeq) return;
      const capturedAt = Number.isFinite(frame.capturedAt) ? frame.capturedAt : Date.now();
      const ptsMs = Math.max(0, this.lastPtsMs + 1, capturedAt - this.startedAt);
      const packet = { ...frame, capturedAt, ptsMs };
      this.lastSeq = frame.seq;
      this.lastPtsMs = ptsMs;
      this.lastPacket = packet;
      this.framesProduced += 1;
      for (const [name, output] of this.outputs) {
        if (output.status?.().state !== 'running') continue;
        try { await output.push(packet); this.outputErrors.delete(name); }
        catch (error) { this.outputErrors.set(name, error.message); this.state = 'degraded'; }
      }
      if (!this.outputErrors.size && this.state === 'degraded') this.state = 'running';
    } finally {
      this.ticking = false;
    }
  }

  async startOutput(name) {
    const output = this.outputs.get(name);
    if (!output) throw new Error(`unknown output: ${name}`);
    if (!this.running()) await this.start();
    if (output.status?.().state === 'running') return this.status();
    try {
      await output.start();
    } catch (error) {
      this.outputErrors.set(name, error.message);
      this.state = 'degraded';
      throw error;
    }
    this.outputErrors.delete(name);
    if (this.lastPacket && output.status?.().state === 'running') {
      try { await output.push(this.lastPacket); } catch (error) { this.outputErrors.set(name, error.message); this.state = 'degraded'; }
    }
    return this.status();
  }

  async stopOutput(name) {
    const output = this.outputs.get(name);
    if (!output) throw new Error(`unknown output: ${name}`);
    await output.stop();
    this.outputErrors.delete(name);
    if (this.running() && !this.outputErrors.size) this.state = 'running';
    return this.status();
  }

  async stop() {
    if (this.state === 'stopped') return this.status();
    this.state = 'stopping';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const errors = [];
    for (const [name, output] of this.outputs) {
      try { await output.stop(); } catch (error) { errors.push(`${name}: ${error.message}`); }
    }
    await this.capture.close?.();
    this.state = errors.length ? 'degraded' : 'stopped';
    if (errors.length) this.outputErrors.set('recorder', errors.join('; '));
    return this.status();
  }
}
