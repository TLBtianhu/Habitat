import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AudioCaptureClient } from './audio-capture-client.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { decodePlaybackFrame, PlaybackVerifier } from './playback-verifier.mjs';
import { writeLiveConfig } from './bilibili-live-config.mjs';
import { ScenePreviewService } from './scene-preview-service.mjs';

const requests = [];
const client = new AudioCaptureClient({
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const body = JSON.parse(options.body);
    const value = body.id ? { closed: true, id: body.id } : { id: 'capture-1', baseline: 8, format: { codec: 's16le', rate: 48000, channels: 2 } };
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
const session = await client.open();
assert.equal(session.id, 'capture-1');
assert.ok(session.url.endsWith('/capture/pcm?id=capture-1'));
await session.close();
assert.equal(requests.length, 2);
assert.throws(() => new AudioCaptureClient({ baseUrl: 'https://example.invalid' }), /loopback/);

const children = [];
const argsSeen = [];
function spawnImpl(_command, args) {
  argsSeen.push(args);
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  child.stdin.write = () => true;
  child.stdin.end = () => child.emit('exit', 0);
  child.stderr = new EventEmitter();
  child.kill = () => {};
  children.push(child);
  queueMicrotask(() => child.emit('spawn'));
  return child;
}
let nextCapture = 0;
const closed = [];
const audioCapture = {
  async open() { nextCapture++; return { id: `A${nextCapture}`, url: `http://127.0.0.1:9271/capture/pcm?id=A${nextCapture}`, close: async () => { closed.push(`A${nextCapture}`); } }; },
};
const output = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'test-key', spawnImpl, audio: 'mixer', audioCapture, reconnectBaseMs: 10 });
await output.start();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(output.status().state, 'running');
assert.equal(output.status().audio, 'mixer');
assert.equal(output.status().audioCaptureId, 'A1');
const firstArgs = argsSeen[0];
for (const expected of ['s16le', '48000', '0:v:0', '1:a:0', 'aac']) assert.ok(firstArgs.includes(expected), `missing ${expected}`);
assert.ok(!firstArgs.some((arg) => String(arg).includes('anullsrc')));
children[0].emit('exit', 187);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(nextCapture, 2, '重连必须打开新音频捕获');
assert.ok(closed.includes('A1'), '旧捕获必须被关闭');
assert.equal(output.status().audioCaptureId, 'A2');
await output.stop();
assert.equal(output.status().state, 'stopped');
assert.ok(closed.includes('A2'));

const failedCapture = { async open() { return { id: 'A-failed', url: 'http://127.0.0.1/capture/pcm?id=A-failed', close: async () => { closed.push('A-failed'); } }; } };
const failedOutput = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'test-key', audio: 'mixer', audioCapture: failedCapture, spawnImpl: () => { throw new Error('spawn failed'); } });
await assert.rejects(() => failedOutput.start(), /spawn failed/);
assert.ok(closed.includes('A-failed'), 'spawn 失败必须关闭音频捕获');

function mediaSpawn(maxVolume, { includeAudio = true } = {}) {
  return (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (command === 'ffprobe') child.stdout.emit('data', JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264' }, ...(includeAudio ? [{ codec_type: 'audio', codec_name: 'aac' }] : [])] }));
      else child.stderr.emit('data', `[Parsed_volumedetect_0 @ 1] max_volume: ${maxVolume} dB`);
      child.emit('close', 0);
    });
    return child;
  };
}
const heard = await decodePlaybackFrame('https://example.test/live', { requireAudio: true, spawnImpl: mediaSpawn(-20) });
assert.equal(heard.audioDecoded, true);
assert.equal(heard.audioNonSilent, true);
assert.equal(heard.audioCodec, 'aac');
await assert.rejects(() => decodePlaybackFrame('https://example.test/live', { requireAudio: true, spawnImpl: mediaSpawn(-91) }), /non-silent audio not observed/);
const quiet = await decodePlaybackFrame('https://example.test/live', { requireAudio: true, allowSilent: true, spawnImpl: mediaSpawn(-91) });
assert.equal(quiet.audioDecoded, true);
assert.equal(quiet.audioNonSilent, false);
await assert.rejects(() => decodePlaybackFrame('https://example.test/live', { requireAudio: true, spawnImpl: mediaSpawn(-20, { includeAudio: false }) }), /audio stream missing/);

const root = path.join(process.cwd(), '.tmp', `audio-verifier-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const configPath = path.join(root, 'live.json');
writeLiveConfig(configPath, { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'live_123_456&key=test' });
let now = 1000;
const response = (data) => ({ json: async () => data });
const fetchImpl = async (url) => {
  if (url.includes('getRoomInfoOld')) return response({ code: 0, data: { roomid: 456 } });
  if (url.includes('get_info')) return response({ code: 0, data: { live_status: 1 } });
  if (url.includes('playUrl')) return response({ code: 0, data: { durl: [{ url: 'https://example.test/live' }] } });
  throw new Error('unexpected URL');
};
const allowSilent = [];
const verifier = new PlaybackVerifier({
  configPath, outputStatus: () => ({ state: 'running' }), fetchImpl, requireAudio: true, now: () => now,
  decoder: async (_url, options) => {
    allowSilent.push(options.allowSilent);
    const nonSilent = allowSilent.length === 1;
    return { videoDecoded: true, audioDecoded: true, audioCodec: 'aac', audioMaxVolumeDb: nonSilent ? -20 : -91, audioNonSilent: nonSilent };
  },
});
try {
  const first = await verifier.verifyNow();
  assert.equal(first.verified, true);
  assert.equal(first.audioVerifiedAt, 1000);
  assert.equal(first.audioNonSilent, true);
  now += 1000;
  const second = await verifier.verifyNow();
  assert.equal(second.verified, true, '首次非静音后允许正常讲话间隔');
  assert.equal(second.audioVerifiedAt, 1000);
  assert.equal(second.audioMaxVolumeDb, -91);
  assert.equal(second.audioEvidenceMaxVolumeDb, -20, '后续静音不得覆盖首次非静音峰值证据');
  assert.equal(second.audioNonSilent, false);
  assert.deepEqual(allowSilent, [false, true]);
  verifier.stop();
  assert.equal(verifier.status().audioDecoded, false);
  verifier.start();
  assert.equal(verifier.audioVerifiedAt, null, '新会话必须重新取得非静音证据');
  verifier.stop();

  let propagated = null;
  const captureMarker = { marker: 'audio-capture' };
  const fakeOutput = { state: 'stopped', status() { return { state: this.state }; }, async stop() { this.state = 'stopped'; } };
  const service = new ScenePreviewService({
    desktopUrl: 'http://127.0.0.1:9260', agentToken: 'test', ownerToken: 'test', port: 0,
    bilibiliConfigPath: configPath, bilibiliAudio: 'mixer', audioCapture: captureMarker,
    bilibiliFactory: (options) => { propagated = options; return fakeOutput; },
    verifier: { start() {}, stop() {}, status: () => ({ state: 'stopped' }), verifyNow: async () => ({ state: 'stopped' }) },
  });
  service.recorder.startOutput = async () => ({});
  await service.startBilibili();
  assert.equal(propagated.audio, 'mixer');
  assert.equal(propagated.audioCapture, captureMarker, '自定义 factory 也必须收到真实音频捕获');
  console.log('ok: Voice PCM 捕获、真实音轨映射、重连清理与首次非静音播放证据');
} finally {
  await output.stop().catch(() => {});
  verifier.stop();
  fs.rmSync(root, { recursive: true, force: true });
}
