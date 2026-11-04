// B 站输出：只消费统一 FramePacket；FFmpeg 编码与网络输出，不持有桌面渲染。
import { spawn } from 'node:child_process';

export class BilibiliRtmpOutput {
  constructor({ target, streamKey = '', ffmpeg = process.env.HABITAT_FFMPEG || 'ffmpeg', fps = 5, bitrate = '3500k', spawnImpl = spawn, stopTimeoutMs = 4000 }) {
    if (!target) throw new Error('Bilibili target required');
    if (/^rtmps?:\/\//.test(target) && !streamKey) throw new Error('Bilibili streamKey required');
    this.target = /^rtmps?:\/\//.test(target) ? `${target.replace(/\/$/, '')}/${streamKey}` : target;
    this.ffmpeg = ffmpeg;
    this.fps = fps;
    this.bitrate = bitrate;
    this.spawn = spawnImpl;
    this.stopTimeoutMs = stopTimeoutMs;
    this.child = null;
    this.state = 'stopped';
    this.frames = 0;
    this.lastSeq = null;
    this.lastPtsMs = null;
    this.lastError = null;
    this.exitCode = null;
    this.verifiedAt = null;
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
    };
  }

  async start() {
    if (this.child) return this.status();
    this.lastError = null;
    this.exitCode = null;
    this.verifiedAt = null;
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(this.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p', '-g', String(Math.max(2, Math.round(this.fps * 2))),
      '-b:v', this.bitrate, '-f', 'flv', this.target,
    ];
    this.child = this.spawn(this.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child.once('spawn', () => { this.state = 'running'; });
    this.child.stderr?.on('data', () => {});
    this.child.once('error', (error) => {
      this.lastError = error.message;
      this.state = 'failed';
    });
    this.child.once('exit', (code) => {
      this.exitCode = code;
      if (this.state !== 'stopped') this.state = code === 0 ? 'stopped' : 'failed';
      if (code !== 0 && !this.lastError) this.lastError = `ffmpeg exited ${code}`;
      this.child = null;
    });
    this.state = 'starting';
    return this.status();
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
  }

  markVerified(at = Date.now()) {
    if (this.state === 'running') this.verifiedAt = at;
    return this.status();
  }

  async stop() {
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
