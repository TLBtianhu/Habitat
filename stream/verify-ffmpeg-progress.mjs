import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';

let now = 0;
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
const output = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret-key', spawnImpl, reconnectBaseMs: 10, audio: 'silent', now: () => now, wallNow: () => now });
try {
  await output.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(argsSeen[0].includes('-progress') && argsSeen[0].includes('pipe:2'));
  children[0].stderr.emit('data', 'frame= 10\nfps= 5.0\nout_time_us=1500000\ntotal_size=12345\nspeed=1.02x\ndup_frames=4\ndrop_frames=2\nbitrate=3500.0kbits/s\n');
  let status = output.status();
  assert.deepEqual(status.progress, { muxFrame: 10, muxFps: 5, outTimeMs: 1500, outSizeBytes: 12345, muxSpeed: 1.02, muxDupFrames: 4, muxDropFrames: 2, muxBitrateKbps: 3500 });
  await output.push({ seq: 1, capturedAt: now - 100, ptsMs: 0, data: Buffer.from([1]) });
  await new Promise((resolve) => setImmediate(resolve));
  now += 200;
  await output.videoInput.tick();
  assert.equal(output.status().lastWriteFrameAgeMs, 300);

  children[0].emit('exit', 187);
  assert.equal(output.status().reconnectCount, 1);
  assert.equal(output.status().lastReconnectAt, 200);
  assert.equal(output.status().lastRecoveredAt, null);
  now += 40;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(children.length, 2);
  await output.push({ seq: 2, capturedAt: now, ptsMs: 100, data: Buffer.from([2]) });
  status = output.status();
  assert.equal(status.reconnectCount, 1);
  assert.equal(status.lastRecoveredAt, 240);
  assert.equal(status.lastReconnectDurationMs, 40);
  assert.equal(status.reconnectAttempts, 0);
  await output.stop();
  status = output.status();
  assert.equal(status.state, 'stopped');
  assert.equal(status.reconnectCount, 1);
  assert.equal(status.lastReconnectDurationMs, 40);
  assert.equal(status.lastKnownProgress.outTimeMs, 1500, '停止后保留最近一次已知的非零输出进度');
  assert.ok(!JSON.stringify(status).includes('secret-key'));
  console.log('ok: FFmpeg 进度、实际帧龄、累计重连与恢复耗时');
} finally {
  await output.stop().catch(() => {});
}
