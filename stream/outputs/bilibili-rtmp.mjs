// B 站输出：只消费统一 FramePacket；FFmpeg 编码与网络输出，不持有桌面渲染。
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { buildBilibiliTarget } from '../bilibili-live-config.mjs';
import { RtmpNetworkPolicy } from '../network-policy.mjs';
import { PacedVideoInput } from '../paced-video-input.mjs';

export class BilibiliRtmpOutput {
  constructor({ target, streamKey = '', ffmpeg = process.env.HABITAT_FFMPEG || 'ffmpeg', fps = 5, bitrate = '3500k', spawnImpl = spawn, stopTimeoutMs = 4000, reconnect = true, maxReconnectAttempts = 5, reconnectBaseMs = 15000, audio = 'none', audioCapture = null, network = null, pacing = true, now = () => performance.now(), wallNow = () => Date.now() }) {
    if (!target) throw new Error('Bilibili target required');
    if (/^rtmps?:\/\//.test(target) && !streamKey) throw new Error('Bilibili streamKey required');
    this.target = buildBilibiliTarget(target, streamKey);
    this.secret = streamKey;
    this.ffmpeg = ffmpeg;
    this.fps = fps;
    this.bitrate = bitrate;
    this.spawn = spawnImpl;
    this.stopTimeoutMs = stopTimeoutMs;
    this.reconnectEnabled = reconnect;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.reconnectBaseMs = reconnectBaseMs;
    this.audio = audio;
    this.audioCapture = audioCapture;
    this.audioSession = null;
    this.enabled = false;
    this.child = null;
    this.reconnectTimer = null;
    this.state = 'stopped';
    this.frames = 0;
    this.lastSeq = null;
    this.lastPtsMs = null;
    this.lastError = null;
    this.exitCode = null;
    this.verifiedAt = null;
    this.reconnectAttempts = 0;
    this.retryAt = null;
    this.stderrTail = '';
    this.network = network || new RtmpNetworkPolicy();
    this.transportClose = null;
    this.pacing = pacing;
    this.now = now;
    this.wallNow = wallNow;
    this.videoInput = null;
    this.lastVideoMetrics = null;
    this.reconnectCount = 0;
    this.reconnectStartedAt = null;
    this.lastReconnectAt = null;
    this.lastRecoveredAt = null;
    this.lastReconnectDurationMs = null;
    this.progress = { muxFrame: 0, muxFps: 0, outTimeMs: 0, outSizeBytes: 0, muxSpeed: null, muxDupFrames: 0, muxDropFrames: 0, muxBitrateKbps: null };
    this.lastKnownProgress = null;
  }

  redact(text) {
    return String(text || '')
      .replace(/rtmps?:\/\/\S+/gi, '[rtmp-target]')
      .replace(/live_\d+_\d+/g, '[stream-id]')
      .replace(/key=[^&\s]+/gi, 'key=[redacted]')
      .replace(/trid=[^&\s]+/gi, 'trid=[redacted]')
      .split(this.secret || '\u0000').join('[redacted]')
      .slice(0, 600);
  }

  readProgress(chunk) {
    const lines = (this.progressTail + chunk.toString()).split(/\r?\n/);
    this.progressTail = lines.pop().slice(-2000);
    for (const line of lines) {
      const match = /^([a-z_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      const value = Number(raw);
      if (key === 'out_time_us' || key === 'out_time_ms') {
        if (Number.isFinite(value)) this.progress.outTimeMs = value / 1000;
        continue;
      }
      if (key === 'speed') {
        this.progress.muxSpeed = Number.isFinite(Number.parseFloat(raw)) ? Number.parseFloat(raw) : null;
        continue;
      }
      if (key === 'bitrate') {
        this.progress.muxBitrateKbps = Number.isFinite(Number.parseFloat(raw)) ? Number.parseFloat(raw) : null;
        continue;
      }
      if (!Number.isFinite(value)) continue;
      if (key === 'frame') this.progress.muxFrame = value;
      else if (key === 'fps') this.progress.muxFps = value;
      else if (key === 'total_size') this.progress.outSizeBytes = value;
      else if (key === 'dup_frames') this.progress.muxDupFrames = value;
      else if (key === 'drop_frames') this.progress.muxDropFrames = value;
    }
    if (this.enabled && this.state === 'running' && this.progress.outTimeMs > 0) this.lastKnownProgress = { ...this.progress };
  }

  status() {
    return {
      state: this.state,
      audio: this.audio,
      audioCaptureId: this.audioSession?.id || null,
      ...(this.videoInput?.status() || this.lastVideoMetrics || { writtenFrames: 0, duplicatedFrames: 0, droppedFrames: 0, standbyFrames: 0, lastWriteAt: null, lastWriteFrameAgeMs: null, lastFrameAgeMs: null }),
      frames: this.frames,
      lastSeq: this.lastSeq,
      lastPtsMs: this.lastPtsMs,
      verifiedAt: this.verifiedAt,
      exitCode: this.exitCode,
      lastError: this.lastError,
      reconnectCount: this.reconnectCount,
      lastReconnectAt: this.lastReconnectAt,
      lastRecoveredAt: this.lastRecoveredAt,
      lastReconnectDurationMs: this.lastReconnectDurationMs,
      progress: { ...this.progress },
      lastKnownProgress: { ...(this.lastKnownProgress || this.progress) },
      reconnectAttempts: this.reconnectAttempts,
      retryAt: this.retryAt,
    };
  }

  async start() {
    if (this.child) return this.status();
    const retry = this.state === 'reconnecting';
    this.enabled = true;
    if (!retry) {
      this.lastError = null;
      this.reconnectAttempts = 0;
    }
    this.exitCode = null;
    this.retryAt = null;
    this.verifiedAt = null;
    this.stderrTail = '';
    this.progressTail = '';
    this.progress = { muxFrame: 0, muxFps: 0, outTimeMs: 0, outSizeBytes: 0, muxSpeed: null, muxDupFrames: 0, muxDropFrames: 0, muxBitrateKbps: null };
    let route;
    try {
      route = await this.network.route(this.target);
      this.transportClose = route.close;
    } catch (error) {
      this.enabled = false;
      this.state = 'failed';
      this.lastError = this.redact(error.message);
      throw error;
    }
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(this.fps), '-i', '-',
    ];
    if (this.audio === 'mixer') {
      if (!this.audioCapture) {
        this.enabled = false;
        this.state = 'failed';
        this.lastError = 'audio capture unavailable';
        await this.closeTransport();
        throw new Error('audio capture unavailable');
      }
      try {
        this.audioSession = await this.audioCapture.open();
      } catch (error) {
        this.enabled = false;
        this.state = 'failed';
        this.lastError = this.redact(error.message);
        await this.closeTransport();
        throw error;
      }
      args.push('-f', 's16le', '-ar', '48000', '-ac', '2', '-i', this.audioSession.url);
    }
    if (this.audio === 'silent') args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(Math.max(2, Math.round(this.fps * 2))), '-b:v', this.bitrate);
    if (this.audio !== 'none') args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '128k', '-shortest');
    if (route.tcUrl) args.push('-rtmp_tcurl', route.tcUrl);
    args.push('-progress', 'pipe:2');
    args.push('-f', 'flv', route.target);
    let child;
    try {
      child = this.spawn(this.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], env: route.env });
    } catch (error) {
      this.enabled = false;
      this.state = 'failed';
      this.lastError = this.redact(error.message);
      await this.closeTransport();
      throw error;
    }
    this.child = child;
    this.child.once('spawn', () => {
      if (this.enabled) {
        this.state = 'running';
        this.startVideoInput();
      }
    });
    this.child.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
      this.readProgress(chunk);
    });
    this.child.once('error', (error) => {
      this.lastError = this.redact(error.message);
      if (this.state !== 'stopping') this.state = 'failed';
    });
    this.child.once('exit', (code) => this.handleExit(code));
    this.state = 'starting';
    return this.status();
  }

  startVideoInput() {
    if (!this.pacing || this.videoInput) return;
    this.lastVideoMetrics = null;
    this.videoInput = new PacedVideoInput({
      fps: this.fps,
      now: this.now,
      wallNow: this.wallNow,
      write: (data) => this.writeVideoFrame(data),
      onError: (error) => {
        if (this.enabled && this.state === 'running') {
          this.lastError = this.redact(error.message);
          this.state = 'degraded';
        }
      },
    });
    this.videoInput.start();
  }

  stopVideoInput() {
    const input = this.videoInput;
    if (input) this.lastVideoMetrics = input.status();
    this.videoInput = null;
    input?.stop();
  }

  async closeAudioSession() {
    const session = this.audioSession;
    this.audioSession = null;
    if (session?.close) await session.close();
  }

  async closeTransport() {
    const close = this.transportClose;
    this.transportClose = null;
    await Promise.all([close ? close() : null, this.closeAudioSession()]);
  }

  handleExit(code) {
    this.exitCode = code;
    this.child = null;
    this.stopVideoInput();
    void this.closeTransport().catch(() => {});
    const intentional = this.state === 'stopping' || this.state === 'stopped';
    if (intentional) {
      this.state = 'stopped';
      return;
    }
    const detail = this.stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
    this.lastError = this.redact(`ffmpeg exited ${code}${detail ? `: ${detail}` : ''}`);
    if (this.enabled && this.reconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectCount += 1;
      this.reconnectStartedAt = this.wallNow();
      this.lastReconnectAt = this.reconnectStartedAt;
      this.reconnectAttempts += 1;
      const delay = Math.min(30000, this.reconnectBaseMs * (2 ** (this.reconnectAttempts - 1)));
      this.state = 'reconnecting';
      this.retryAt = Date.now() + delay;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.start().catch((error) => {
          this.lastError = this.redact(error.message);
          this.state = 'failed';
        });
      }, delay);
      this.reconnectTimer.unref?.();
    } else {
      this.state = 'failed';
    }
  }

  async writeVideoFrame(data) {
    const child = this.child;
    if (this.state !== 'running' || !child?.stdin?.writable) throw new Error('Bilibili output is not running');
    await new Promise((resolve, reject) => {
      const onError = (error) => { cleanup(); reject(error); };
      const onDrain = () => { cleanup(); resolve(); };
      const cleanup = () => {
        child.stdin.off('error', onError);
        child.stdin.off('drain', onDrain);
      };
      child.stdin.once('error', onError);
      child.stdin.once('drain', onDrain);
      const accepted = child.stdin.write(data);
      if (accepted) {
        cleanup();
        resolve();
      }
    });
  }

  async push(packet) {
    if (this.state !== 'running' || !this.child?.stdin?.writable) throw new Error('Bilibili output is not running');
    if (!this.pacing) await this.writeVideoFrame(packet.data);
    else this.videoInput.offer(packet);
    this.frames += 1;
    this.lastSeq = packet.seq;
    this.lastPtsMs = packet.ptsMs;
    this.reconnectAttempts = 0;
    if (this.reconnectStartedAt !== null) {
      this.lastRecoveredAt = this.wallNow();
      this.lastReconnectDurationMs = Math.max(0, this.lastRecoveredAt - this.reconnectStartedAt);
      this.reconnectStartedAt = null;
    }
    this.lastError = null;
  }

  markVerified(at = Date.now()) {
    if (this.state === 'running') this.verifiedAt = at;
    return this.status();
  }

  async stop() {
    this.enabled = false;
    this.reconnectStartedAt = null;
    this.stopVideoInput();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryAt = null;
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
      await this.closeTransport();
      return this.status();
    }
    this.state = 'stopping';
    try { child.stdin.end(); } catch {}
    const wait = async (ms) => {
      const deadline = Date.now() + ms;
      while (this.child && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      return !this.child;
    };
    if (await wait(this.stopTimeoutMs)) {
      this.state = 'stopped';
      await this.closeTransport();
      return this.status();
    }
    try { child.kill('SIGTERM'); } catch {}
    if (await wait(this.stopTimeoutMs)) {
      this.state = 'stopped';
      await this.closeTransport();
      return this.status();
    }
    try { child.kill('SIGKILL'); } catch {}
    if (await wait(250)) {
      this.state = 'stopped';
      await this.closeTransport();
      return this.status();
    }
    this.state = 'degraded';
    this.lastError = 'stop_timeout';
    await this.closeTransport();
    throw new Error('stop_timeout');
  }
}
