import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SceneRecorder } from './scene-recorder.mjs';
import { CaptureClient } from './capture-client.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';

const root = process.env.HABITAT_INSTANCE_ROOT || '/opt/habitat';
const target = `${root}/data/artifacts/scene-recorder-test.flv`;
const agentToken = fs.readFileSync(`${root}/config/agent.token`, 'utf8').trim();
const ownerToken = fs.readFileSync(`${root}/config/owner.token`, 'utf8').trim();
const capture = new CaptureClient({ desktopUrl: process.env.FB_DESKTOP_URL || 'http://127.0.0.1:9260', token: agentToken, fps: 2 });
const preview = new ConsolePreviewOutput({ token: ownerToken, port: 0 });
const output = new BilibiliRtmpOutput({ target, fps: 2 });
const recorder = new SceneRecorder({ capture, outputs: { console: preview, bilibili: output }, fps: 2 });
try {
  await recorder.startOutput('console');
  await recorder.startOutput('bilibili');
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const status = recorder.status();
  assert.ok(status.framesProduced > 0, 'desktop did not produce a frame');
  assert.ok(output.status().frames > 0, 'FFmpeg did not receive a frame');
  const previewResponse = await fetch(preview.status().url, { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.headers.get('x-frame-seq'), String(status.frameSeq));
  await recorder.stop();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'json', target], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].codec_name, 'h264');
  assert.ok(Number(probe.streams[0].nb_read_frames) > 0);
  console.log(JSON.stringify({ framesProduced: status.framesProduced, previewSeq: status.frameSeq, ffmpegFrames: Number(probe.streams[0].nb_read_frames), output: 'local-file' }));
} finally {
  await recorder.stop().catch(() => {});
  fs.rmSync(target, { force: true });
}
