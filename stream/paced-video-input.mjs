// 墙钟节奏的视频输入：最新帧可重复，过期只输出明确待机帧；不向编码器堆积历史帧。
import { createStandbyFrame } from './standby-frame.mjs';

export class PacedVideoInput {
  constructor({ fps, write, onError, now = () => Date.now(), maxAgeMs = 2500, standbyFrame = null }) {
    if (!Number.isSafeInteger(fps) || fps < 1 || fps > 60) throw new Error('invalid output fps');
    this.fps = fps;
    this.intervalMs = 1000 / fps;
    this.write = write;
    this.onError = onError;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.standbyFrame = standbyFrame || createStandbyFrame();
    this.latest = null;
    this.startedAt = null;
    this.nextWriteAt = null;
    this.timer = null;
    this.writing = false;
    this.stopped = true;
    this.lastWrittenSeq = null;
    this.writtenFrames = 0;
    this.duplicatedFrames = 0;
    this.droppedFrames = 0;
    this.standbyFrames = 0;
    this.lastWriteAt = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.startedAt = this.now();
    this.nextWriteAt = this.startedAt;
    this.timer = setInterval(() => { void this.tick(); }, Math.max(4, Math.floor(this.intervalMs / 2)));
    this.timer.unref?.();
    void this.tick();
  }

  offer(packet) {
    if (this.stopped) return;
    if (!packet?.data?.length || !Number.isFinite(packet.capturedAt)) return;
    this.latest = packet;
  }

  async tick() {
    if (this.stopped || this.writing) return;
    const at = this.now();
    if (at < this.nextWriteAt) return;
    this.nextWriteAt += this.intervalMs;
    if (this.nextWriteAt < at) {
      this.droppedFrames += Math.max(0, Math.floor((at - this.nextWriteAt) / this.intervalMs));
      this.nextWriteAt = at + this.intervalMs;
    }
    const packet = this.latest;
    const stale = !packet || at - packet.capturedAt > this.maxAgeMs;
    const data = stale ? this.standbyFrame : packet.data;
    const seq = stale ? null : packet.seq;
    this.writing = true;
    try {
      await this.write(data);
      this.writtenFrames += 1;
      if (stale) this.standbyFrames += 1;
      else if (seq === this.lastWrittenSeq) this.duplicatedFrames += 1;
      else this.lastWrittenSeq = seq;
      this.lastWriteAt = at;
    } catch (error) {
      if (!this.stopped) this.onError(error);
    } finally {
      this.writing = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.latest = null;
  }

  status() {
    return {
      fps: this.fps,
      startedAt: this.startedAt,
      writtenFrames: this.writtenFrames,
      duplicatedFrames: this.duplicatedFrames,
      droppedFrames: this.droppedFrames,
      standbyFrames: this.standbyFrames,
      lastWriteAt: this.lastWriteAt,
      lastFrameAgeMs: this.latest ? Math.max(0, this.now() - this.latest.capturedAt) : null,
    };
  }
}
