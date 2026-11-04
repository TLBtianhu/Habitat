// B 站输出：只消费统一 FramePacket；FFmpeg 编码与网络输出，不持有桌面渲染。
import { spawn } from 'node:child_process';
import { buildBilibiliTarget } from '../bilibili-live-config.mjs';

export class BilibiliRtmpOutput {
  constructor({ target, streamKey = '', ffmpeg = process.env.HABITAT_FFMPEG || 'ffmpeg', fps = 5, bitrate = '3500k', spawnImpl = spawn, stopTimeoutMs = 4000, reconnect = true, maxReconnectAttempts = 5, reconnectBaseMs = 15000, audio = 'none' }) {
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

  status() {
    return {
      state: this.state,
      frames: this.frames,
      lastSeq: this.lastSeq,
      lastPtsMs: this.lastPtsMs,
      verifiedAt: this.verifiedAt,
      exitCode: this.exitCode,
      lastError: this.lastError,
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
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(this.fps), '-i', '-',
    ];
    if (this.audio === 'silent') args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(Math.max(2, Math.round(this.fps * 2))), '-b:v', this.bitrate);
    if (this.audio === 'silent') args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    args.push('-f', 'flv', this.target);
    this.child = this.spawn(this.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child.once('spawn', () => { if (this.enabled) this.state = 'running'; });
    this.child.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });
    this.child.once('error', (error) => {
      this.lastError = this.redact(error.message);
      if (this.state !== 'stopping') this.state = 'failed';
    });
    this.child.once('exit', (code) => this.handleExit(code));
    this.state = 'starting';
    return this.status();
  }

  handleExit(code) {
    this.exitCode = code;
    this.child = null;
    const intentional = this.state === 'stopping' || this.state === 'stopped';
    if (intentional) {
      this.state = 'stopped';
      return;
    }
    const detail = this.stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
    this.lastError = this.redact(`ffmpeg exited ${code}${detail ? `: ${detail}` : ''}`);
    if (this.enabled && this.reconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
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

  async push(packet) {
    if (this.state !== 'running' || !this.child?.stdin?.writable) throw new Error('Bilibili output is not running');
    await new Promise((resolve, reject) => {
      const onError = (error) => { cleanup(); reject(error); };
      const onDrain = () => { cleanup(); resolve(); };
      const cleanup = () => {
        this.child.stdin.off('error', onError);
        this.child.stdin.off('drain', onDrain);
      };
      this.child.stdin.once('error', onError);
      this.child.stdin.once('drain', onDrain);
      const accepted = this.child.stdin.write(packet.data);
      if (accepted) {
        cleanup();
        resolve();
      }
    });
    this.frames += 1;
    this.lastSeq = packet.seq;
    this.lastPtsMs = packet.ptsMs;
    this.reconnectAttempts = 0;
    this.lastError = null;
  }

  markVerified(at = Date.now()) {
    if (this.state === 'running') this.verifiedAt = at;
    return this.status();
  }

  async stop() {
    this.enabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryAt = null;
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
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
      return this.status();
    }
    try { child.kill('SIGTERM'); } catch {}
    if (await wait(this.stopTimeoutMs)) {
      this.state = 'stopped';
      return this.status();
    }
    try { child.kill('SIGKILL'); } catch {}
    if (await wait(250)) {
      this.state = 'stopped';
      return this.status();
    }
    this.state = 'degraded';
    this.lastError = 'stop_timeout';
    throw new Error('stop_timeout');
  }
}
