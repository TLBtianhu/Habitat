// 持久化事件泵：心跳/退避/去重/有界队列/死信/处理水位，不绑定具体平台协议。
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanEvent(e) {
  return { id: e.id, from: String(e.from || 'unknown'), text: String(e.text || ''), at: e.at || Date.now() };
}

export class DurableEventPump {
  constructor({
    source,
    read,
    stateFile,
    pollIntervalMs = 1000,
    maxQueue = 100,
    maxRecent = 12,
    selfFrom = 'dafeiyu',
  }) {
    if (typeof read !== 'function') throw new Error('read function required');
    this.source = source;
    this.read = read;
    this.stateFile = stateFile;
    this.pollIntervalMs = pollIntervalMs;
    this.maxQueue = maxQueue;
    this.maxRecent = maxRecent;
    this.selfFrom = selfFrom;
    this.state = {
      schemaVersion: 1,
      source,
      watermark: 0,
      recent: [],
      pending: [],
      deadLetter: [],
      lastPollAt: 0,
      lastSuccessAt: 0,
      lastError: null,
      reconnectAttempt: 0,
      nextRetryAt: 0,
    };
    this.running = false;
    this.initialized = false;
    this.polling = false;
    this.timer = null;
  }

  _load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (saved.schemaVersion !== 1 || saved.source !== this.source) return;
      for (const key of ['watermark', 'recent', 'pending', 'deadLetter', 'lastPollAt', 'lastSuccessAt', 'lastError', 'reconnectAttempt', 'nextRetryAt']) {
        if (saved[key] !== undefined) this.state[key] = saved[key];
      }
    } catch {}
  }

  _save() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }

  async init() {
    this._load();
    try {
      const events = await this.read();
      const maxId = events.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
      if (!fs.existsSync(this.stateFile) || maxId < this.state.watermark) {
        this.state.watermark = maxId;
        this.state.pending = [];
        this.state.recent = events.slice(-this.maxRecent).map(cleanEvent);
      } else {
        this.state.recent = events.slice(-this.maxRecent).map(cleanEvent);
      }
      this.state.lastSuccessAt = Date.now();
      this.state.lastError = null;
      this._save();
    } catch (e) {
      this.state.lastError = e.message;
      this.state.reconnectAttempt += 1;
      this.state.nextRetryAt = Date.now() + 1000;
      this._save();
    }
    this.initialized = true;
  }

  async start() {
    if (this.running) return;
    if (!this.initialized) await this.init();
    this.running = true;
    this._schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const deadline = Date.now() + 2000;
    while (this.polling && Date.now() < deadline) await sleep(20);
  }

  _schedule(delay) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pollOnce(), Math.max(0, delay));
  }

  async pollOnce() {
    if (this.polling || !this.running) return;
    this.polling = true;
    this.state.lastPollAt = Date.now();
    try {
      const events = await this.read();
      if (!Array.isArray(events)) throw new Error('event source must return array');
      const maxId = events.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
      if (maxId < this.state.watermark) {
        this.state.watermark = maxId;
        this.state.pending = [];
        this.state.recent = events.slice(-this.maxRecent).map(cleanEvent);
      }
      for (const raw of events) {
        const e = cleanEvent(raw);
        if (!Number.isSafeInteger(e.id) || e.id <= this.state.watermark) continue;
        if (this.state.recent.some((x) => x.id === e.id) || this.state.pending.some((x) => x.id === e.id)) {
          this.state.watermark = Math.max(this.state.watermark, e.id);
          continue;
        }
        this.state.recent.push(e);
        this.state.watermark = Math.max(this.state.watermark, e.id);
        if (e.from === this.selfFrom) continue;
        if (this.state.pending.length >= this.maxQueue) {
          this.state.deadLetter.push({ event: e, reason: 'queue_full', at: Date.now() });
          continue;
        }
        this.state.pending.push(e);
      }
      this.state.recent = this.state.recent.slice(-this.maxRecent);
      this.state.deadLetter = this.state.deadLetter.slice(-50);
      this.state.lastSuccessAt = Date.now();
      this.state.lastError = null;
      this.state.reconnectAttempt = 0;
      this.state.nextRetryAt = 0;
      this._save();
      this._schedule(this.pollIntervalMs);
    } catch (e) {
      this.state.lastError = e.message;
      this.state.reconnectAttempt += 1;
      const base = Math.min(30000, 1000 * 2 ** (this.state.reconnectAttempt - 1));
      const delay = Math.round(base * (1 + Math.random() * 0.25));
      this.state.nextRetryAt = Date.now() + delay;
      this._save();
      this._schedule(delay);
    } finally {
      this.polling = false;
    }
  }

  obs() {
    return {
      channel: this.source,
      recent: this.state.recent.map((e) => ({ ...e })),
      new: this.state.pending.map((e) => ({ ...e })),
    };
  }

  complete(ids) {
    const done = new Set(ids);
    this.state.pending = this.state.pending.filter((e) => !done.has(e.id));
    this._save();
  }

  status() {
    return {
      source: this.source,
      running: this.running,
      polling: this.polling,
      watermark: this.state.watermark,
      pending: this.state.pending.length,
      deadLetter: this.state.deadLetter.length,
      lastPollAt: this.state.lastPollAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastError: this.state.lastError,
      reconnectAttempt: this.state.reconnectAttempt,
      nextRetryAt: this.state.nextRetryAt,
    };
  }
}
