import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PlaybackVerifier } from './playback-verifier.mjs';
import { writeLiveConfig } from './bilibili-live-config.mjs';

const root = path.join(process.cwd(), '.tmp', `playback-verifier-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const configPath = path.join(root, 'bilibili-live.json');
writeLiveConfig(configPath, { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'live_123_456&key=abc' });
let now = 1000;
let decodeCalls = 0;
let output = { state: 'running' };
const response = (data) => ({ json: async () => data });
const fetchImpl = async (url) => {
  if (url.includes('getRoomInfoOld')) return response({ code: 0, data: { roomid: 456 } });
  if (url.includes('get_info')) return response({ code: 0, data: { live_status: 1 } });
  if (url.includes('playUrl')) return response({ code: 0, data: { durl: [{ url: 'https://example.test/live.flv' }] } });
  throw new Error('unexpected URL');
};
const verifier = new PlaybackVerifier({
  configPath,
  outputStatus: () => output,
  fetchImpl,
  decoder: async () => { decodeCalls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return true; },
  now: () => now,
  ttlMs: 50,
  intervalMs: 1000,
});
try {
  const [first, second] = await Promise.all([verifier.verifyNow(), verifier.verifyNow()]);
  assert.equal(decodeCalls, 1);
  assert.equal(first.verified, true);
  assert.equal(second.verified, true);
  assert.equal(first.lastVerifiedAt, now);
  now += 100;
  assert.equal(verifier.status().state, 'stale');
  assert.equal(verifier.status().verified, false);
  verifier.decoder = async () => { throw new Error('decode failed'); };
  const failed = await verifier.verifyNow();
  assert.equal(failed.state, 'stale');
  assert.equal(failed.lastVerifiedAt, 1000);
  assert.equal(failed.consecutiveFailures, 1);
  verifier.decoder = async () => { decodeCalls += 1; return true; };
  const recovered = await verifier.verifyNow();
  assert.equal(recovered.verified, true);
  assert.equal(recovered.lastError, null);
  let finishNextDecode;
  verifier.decoder = () => new Promise((resolve) => { finishNextDecode = resolve; });
  const checking = verifier.verifyNow();
  await new Promise((resolve) => setImmediate(resolve));
  const duringCheck = verifier.status();
  assert.equal(duringCheck.state, 'verified', '扫描期间的新鲜成功证据不能立即降级');
  assert.equal(duringCheck.verified, true);
  assert.equal(duringCheck.checkInFlight, true);
  finishNextDecode(true);
  await checking;
  verifier.decoder = async () => { throw new Error('transient'); };
  const transient = await verifier.verifyNow();
  assert.equal(transient.verified, true);
  assert.equal(transient.playbackDecoded, false);
  assert.equal(transient.lastError, 'transient');
  verifier.consecutiveFailures = 3;
  const beforeSkip = decodeCalls;
  await verifier.verifyNow(false);
  assert.equal(decodeCalls, beforeSkip);
  verifier.decoder = async () => { decodeCalls += 1; return true; };
  await verifier.verifyNow(true);
  assert.equal(decodeCalls, beforeSkip + 1);
  output = { state: 'stopped' };
  const before = decodeCalls;
  const stopped = await verifier.verifyNow();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.verified, false);
  assert.equal(decodeCalls, before);
  output = { state: 'running' };
  verifier.start();
  await verifier.verifyNow();
  verifier.stop();
  assert.equal(verifier.status().state, 'stopped');
  output = { state: 'stopped' };
  verifier.lastError = 'previous';
  verifier.lastVerifiedAt = 123;
  verifier.lastCheckedAt = 456;
  verifier.consecutiveFailures = 2;
  verifier.start();
  assert.equal(verifier.lastError, null);
  assert.equal(verifier.lastVerifiedAt, null);
  assert.equal(verifier.lastCheckedAt, null);
  assert.equal(verifier.consecutiveFailures, 0);
  verifier.stop();
  console.log('ok: 播放验证合并刷新、真实成功/失败、过期恢复、停止与周期清理');
} finally {
  verifier.stop();
  fs.rmSync(root, { recursive: true, force: true });
}
