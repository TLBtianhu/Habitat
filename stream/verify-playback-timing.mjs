import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzePlaybackFrames, probePlaybackTiming } from './playback-timing.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { createStandbyFrame } from './standby-frame.mjs';

const analysis = analyzePlaybackFrames([
  { media_type: 'video', best_effort_timestamp_time: '0.000' },
  { media_type: 'video', best_effort_timestamp_time: '0.200' },
  { media_type: 'video', best_effort_timestamp_time: '0.500' },
  { media_type: 'video', best_effort_timestamp_time: '0.400' },
  { media_type: 'video', best_effort_timestamp_time: '1.100' },
  { media_type: 'audio', best_effort_timestamp_time: '0.000' },
  { media_type: 'audio', best_effort_timestamp_time: '0.100' },
  { media_type: 'audio', best_effort_timestamp_time: '0.300' },
  { media_type: 'audio', best_effort_timestamp_time: '0.500' },
], { wallDurationMs: 1000, requireAudio: true });
assert.equal(analysis.video.nonMonotonicCount, 1);
assert.equal(analysis.video.intervalP50Ms, 200);
assert.equal(analysis.video.maxGapMs, 600);
assert.equal(analysis.startSkewMs, 0);
assert.equal(analysis.spanSkewMs, 600);
assert.ok(analysis.alerts.includes('non_monotonic_video_timestamps'));
assert.ok(analysis.alerts.includes('av_span_skew_over_500ms'));
assert.equal(analysis.mediaToWallRatio, 1.1);
assert.throws(() => analyzePlaybackFrames([{ media_type: 'video', best_effort_timestamp_time: '0' }], { requireAudio: true }), /audio frames missing/);

const toolsAvailable = ['ffmpeg', 'ffprobe'].every((command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0);
if (!toolsAvailable) {
  console.log('skip: real FLV timing requires ffmpeg/ffprobe');
} else {
  const root = path.join(process.cwd(), '.tmp', `playback-timing-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'timing-sample.flv');
  const output = new BilibiliRtmpOutput({
    target: file, fps: 5, audio: 'silent',
    network: { route: async (target) => ({ target, env: { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', NO_PROXY: '*' }, close: async () => {} }) },
  });
  try {
    await output.start();
    for (let i = 0; i < 50 && output.state !== 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    if (output.state !== 'running') throw new Error('FFmpeg did not reach running state');
    for (let i = 1; i <= 12; i++) {
      await output.push({ seq: i, capturedAt: Date.now(), ptsMs: i * 200, data: createStandbyFrame() });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await output.stop();
    const outputStatus = output.status();
    assert.equal(outputStatus.rateControl.mode, 'vbv');
    assert.equal(outputStatus.rateControl.maxRateKbps, 3500);
    assert.equal(outputStatus.rateControl.vbvBufferKbps, 7000);
    assert.equal(outputStatus.recentSessions.length, 1);
    assert.equal(outputStatus.recentSessions[0].stopReason, 'owner_stop');
    assert.ok(outputStatus.recentSessions[0].progress.outTimeMs > 0);
    const real = await probePlaybackTiming(file, { requireAudio: true });
    assert.ok(real.video.frames > 0);
    assert.ok(real.audio?.frames > 0);
    assert.ok(real.video.intervalP50Ms > 100 && real.video.intervalP50Ms < 350);
    assert.ok(real.video.maxGapMs < 2000);
    assert.equal(real.video.nonMonotonicCount, 0);
    assert.equal(real.audio.nonMonotonicCount, 0);
    assert.ok(real.startSkewMs < 1000);
    assert.ok(real.spanSkewMs < 1000);
    console.log(JSON.stringify({ result: 'playback_timing_verified', video: real.video, audio: real.audio, startSkewMs: real.startSkewMs, spanSkewMs: real.spanSkewMs, alerts: real.alerts }));
  } finally {
    await output.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
}
