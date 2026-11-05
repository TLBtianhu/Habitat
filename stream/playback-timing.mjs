// 独立播放节奏分析：只分析公开播放地址，不读取推流凭证，不把 speed/codec 当作健康证明。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function percentile(values, p) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))];
}

function series(frames, type) {
  const rawTimes = frames.filter((frame) => frame.media_type === type)
    .map((frame) => Number(frame.best_effort_timestamp_time) * 1000)
    .filter(Number.isFinite);
  const times = [...rawTimes].sort((a, b) => a - b);
  const intervals = times.slice(1).map((value, index) => value - times[index]);
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    frames: times.length,
    firstMs: times[0] ?? null,
    lastMs: times.at(-1) ?? null,
    spanMs: times.length > 1 ? times.at(-1) - times[0] : 0,
    intervalP50Ms: percentile(sorted, 0.5),
    intervalP95Ms: percentile(sorted, 0.95),
    maxGapMs: intervals.length ? Math.max(...intervals) : null,
    nonMonotonicCount: rawTimes.slice(1).filter((value, index) => value < rawTimes[index] - 1).length,
  };
}

export function analyzePlaybackFrames(frames, { wallDurationMs = null, requireAudio = false } = {}) {
  const video = series(frames, 'video');
  const audio = series(frames, 'audio');
  if (!video.frames) throw new Error('video frames missing');
  if (requireAudio && !audio.frames) throw new Error('audio frames missing');
  const startSkewMs = audio.frames ? Math.abs(video.firstMs - audio.firstMs) : null;
  const spanSkewMs = audio.frames ? Math.abs(video.spanMs - audio.spanMs) : null;
  const alerts = [];
  if (video.nonMonotonicCount) alerts.push('non_monotonic_video_timestamps');
  if (audio.nonMonotonicCount) alerts.push('non_monotonic_audio_timestamps');
  if (video.maxGapMs !== null && video.maxGapMs > 2000) alerts.push('video_gap_over_2000ms');
  if (startSkewMs !== null && startSkewMs > 500) alerts.push('av_start_skew_over_500ms');
  if (spanSkewMs !== null && spanSkewMs > 500) alerts.push('av_span_skew_over_500ms');
  const mediaDurationMs = Math.max(video.lastMs, audio.lastMs ?? -Infinity) - Math.min(video.firstMs, audio.firstMs ?? Infinity);
  return {
    video,
    audio: audio.frames ? audio : null,
    startSkewMs,
    spanSkewMs,
    mediaDurationMs,
    wallDurationMs,
    mediaToWallRatio: wallDurationMs > 0 ? mediaDurationMs / wallDurationMs : null,
    alerts,
  };
}

export async function probePlaybackTiming(url, { timeoutMs = 30000, durationMs = 6000, spawnImpl = spawn, requireAudio = false, captureFile = null } = {}) {
  const startedAt = Date.now();
  const temporary = captureFile ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-playback-timing-'));
  const file = captureFile || path.join(temporary, 'sample.flv');
  if (captureFile) fs.mkdirSync(path.dirname(captureFile), { recursive: true });
  const run = (command, args) => new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', no_proxy: '*', NO_PROXY: '*' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} timing capture failed: ${stderr.replace(/https?:\/\/\S+/g, '[playback-url]').slice(0, 300)}`));
      else resolve({ stdout, stderr });
    });
  });
  try {
    const headers = /^https?:\/\//i.test(url) ? ['-headers', 'Referer: https://live.bilibili.com/\r\nUser-Agent: Mozilla/5.0\r\n'] : [];
    await run('ffmpeg', ['-y', '-v', 'error', ...headers, '-i', url, '-t', String(Math.max(1, Math.round(durationMs / 1000))), '-c', 'copy', file]);
    const wallDurationMs = Date.now() - startedAt;
    const probed = await run('ffprobe', ['-v', 'error', '-show_frames', '-show_entries', 'frame=media_type,best_effort_timestamp_time,pkt_dts_time,pkt_duration_time', '-of', 'json', '-i', file]);
    const data = JSON.parse(probed.stdout);
    return analyzePlaybackFrames(data.frames || [], { wallDurationMs, requireAudio });
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
