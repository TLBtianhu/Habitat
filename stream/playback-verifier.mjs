// 独立播放验证器：不接触推流进程，只通过公开房间和播放地址验证真实播放。
import { spawn } from 'node:child_process';
import { normalizeStreamKey, readLiveConfig } from './bilibili-live-config.mjs';

function safeError(error) {
  return String(error?.message || error).replace(/(?:rtmps?|https?):\/\/\S+/gi, '[url]').slice(0, 500);
}

async function decodePlaybackFrame(url, { timeoutMs = 15000, spawnImpl = spawn } = {}) {
  const child = spawnImpl('ffmpeg', ['-v', 'error', '-headers', 'Referer: https://live.bilibili.com/\r\nUser-Agent: Mozilla/5.0\r\n', '-i', url, '-frames:v', '1', '-f', 'null', '-'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', no_proxy: '*', NO_PROXY: '*' },
  });
  let stderr = '';
  const close = new Promise((resolve) => child.once('close', resolve));
  child.once('error', () => {});
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const code = await close;
  clearTimeout(timer);
  if (code !== 0) throw new Error(`playback decode failed: ${stderr.replace(/https?:\/\/\S+/g, '[playback-url]').slice(0, 300)}`);
  return true;
}

export class PlaybackVerifier {
  constructor({ configPath = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/opt/habitat/config/bilibili-live.json', outputStatus = () => ({ state: 'stopped' }), fetchImpl = fetch, decoder = decodePlaybackFrame, intervalMs = 15000, ttlMs = 45000, now = () => Date.now(), timeoutMs = 10000 }) {
    this.configPath = configPath;
    this.outputStatus = outputStatus;
    this.fetch = fetchImpl;
    this.decoder = decoder;
    this.intervalMs = Math.max(1000, intervalMs);
    this.ttlMs = Math.max(1, ttlMs);
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.enabled = false;
    this.generation = 0;
    this.inflight = null;
    this.timer = null;
    this.state = 'idle';
    this.lastCheckedAt = null;
    this.lastVerifiedAt = null;
    this.lastError = null;
    this.liveStatus = null;
    this.playbackDecoded = false;
    this.consecutiveFailures = 0;
  }

  status() {
    const output = this.outputStatus() || { state: 'stopped' };
    if (output.state === 'stopped') return { ...this.snapshot('stopped', false), outputState: 'stopped' };
    if (this.state === 'checking') return { ...this.snapshot('checking', false), outputState: output.state };
    if (this.state === 'verified' && this.lastVerifiedAt && this.now() - this.lastVerifiedAt <= this.ttlMs && output.state === 'running') {
      return { ...this.snapshot('verified', true), outputState: output.state };
    }
    const state = this.state === 'verified' ? 'stale' : this.state;
    return { ...this.snapshot(state, false), outputState: output.state };
  }

  snapshot(state, verified) {
    return {
      state,
      verified,
      lastCheckedAt: this.lastCheckedAt,
      lastVerifiedAt: this.lastVerifiedAt,
      lastError: this.lastError,
      liveStatus: this.liveStatus,
      playbackDecoded: this.playbackDecoded,
      consecutiveFailures: this.consecutiveFailures,
      intervalMs: this.intervalMs,
      ttlMs: this.ttlMs,
    };
  }

  async fetchJson(url) {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    const data = await response.json();
    if (data.code !== 0) throw new Error(`Bilibili API ${data.code}: ${data.message || 'failed'}`);
    return data.data;
  }

  async perform() {
    const generation = this.generation;
    const output = this.outputStatus() || { state: 'stopped' };
    if (output.state !== 'running') {
      this.state = output.state === 'starting' ? 'starting' : 'stopped';
      this.playbackDecoded = false;
      return this.status();
    }
    this.state = 'checking';
    this.lastCheckedAt = this.now();
    try {
      const config = readLiveConfig(this.configPath);
      const uid = normalizeStreamKey(config.streamKey).match(/streamname=live_(\d+)_/)?.[1];
      if (!uid) throw new Error('cannot resolve Bilibili uid');
      const room = await this.fetchJson(`https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=${uid}`);
      if (!room.roomid) throw new Error('cannot resolve Bilibili room');
      const info = await this.fetchJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${room.roomid}`);
      this.liveStatus = info.live_status ?? null;
      const play = await this.fetchJson(`https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${room.roomid}&quality=0&platform=web`);
      const playbackUrl = play.durl?.[0]?.url;
      if (!playbackUrl) throw new Error(`no playable stream (liveStatus=${this.liveStatus})`);
      await this.decoder(playbackUrl, { timeoutMs: this.timeoutMs });
      if (generation !== this.generation) return this.status();
      this.state = 'verified';
      this.lastVerifiedAt = this.now();
      this.lastError = null;
      this.playbackDecoded = true;
      this.consecutiveFailures = 0;
    } catch (error) {
      if (generation !== this.generation) return this.status();
      this.state = 'degraded';
      this.lastError = safeError(error);
      this.playbackDecoded = false;
      this.consecutiveFailures += 1;
    }
    return this.status();
  }

  verifyNow() {
    if (this.inflight) return this.inflight;
    this.inflight = this.perform().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  start() {
    if (this.enabled) return this.status();
    this.enabled = true;
    this.generation += 1;
    this.state = 'idle';
    this.verifyNow().catch(() => {});
    this.timer = setInterval(() => { this.verifyNow().catch(() => {}); }, this.intervalMs);
    this.timer.unref?.();
    return this.status();
  }

  stop() {
    this.enabled = false;
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = 'stopped';
    this.playbackDecoded = false;
    return this.status();
  }
}
