import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';

const children = [];
const argsSeen = [];
function spawnImpl(_ffmpeg, args) {
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
const output = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret-key', spawnImpl, reconnectBaseMs: 10, maxReconnectAttempts: 2, audio: 'silent' });
try {
  await output.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(output.status().state, 'running');
  await output.push({ seq: 1, ptsMs: 0, data: Buffer.from([1]) });
  children[0].emit('exit', 187);
  assert.equal(output.status().state, 'reconnecting');
  assert.ok(output.status().retryAt);
  assert.ok(!output.status().lastError.includes('secret-key'));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(children.length, 2);
  assert.equal(output.status().state, 'running');
  await output.push({ seq: 2, ptsMs: 200, data: Buffer.from([2]) });
  assert.equal(output.status().reconnectAttempts, 0);
  assert.ok(argsSeen[0].includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  await output.stop();
  assert.equal(output.status().state, 'stopped');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(children.length, 2);
  console.log('ok: RTMP 意外退出退避重连、静音 AAC、错误脱敏与 owner 停止');
} finally {
  await output.stop().catch(() => {});
}
