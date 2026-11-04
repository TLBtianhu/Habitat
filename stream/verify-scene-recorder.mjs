import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SceneRecorder } from './scene-recorder.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';

const root = `/tmp/habitat-scene-test-${process.pid}`;
const frame = (seq, at) => ({ seq, capturedAt: at, width: 2, height: 2, format: 'png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, seq]) });
const frames = [frame(1, 1000), frame(1, 1000), frame(2, 2000), frame(3, 3000)];
let openCount = 0;
let closeCount = 0;
let pollCount = 0;
const capture = {
  async open() { openCount += 1; },
  async close() { closeCount += 1; },
  async poll() { return frames[pollCount++] || null; },
};
const preview = new ConsolePreviewOutput({ token: 'owner-test', port: 0 });
const other = {
  state: 'stopped', packets: [],
  status() { return { state: this.state, frames: this.packets.length }; },
  async start() { this.state = 'running'; },
  async push(packet) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated output failure');
    }
    this.packets.push(packet);
  },
  async stop() { this.state = 'stopped'; },
};
const recorder = new SceneRecorder({ capture, outputs: { console: preview, bilibili: other }, fps: 5 });
try {
  await recorder.startOutput('console');
  await recorder.startOutput('bilibili');
  await recorder.tick();
  await recorder.tick();
  const status = recorder.status();
  assert.equal(status.framesProduced, 2);
  assert.equal(other.packets.length, 2);
  assert.deepEqual(other.packets.map((p) => p.seq), [1, 2]);
  assert.equal(preview.status().lastSeq, 2);
  assert.ok(other.packets[1].ptsMs > other.packets[0].ptsMs);
  assert.equal(other.packets[1].data, preview.latest?.data);
  assert.equal(other.packets[1].ptsMs, preview.latest?.ptsMs);
  const url = preview.status().url;
  const denied = await fetch(url);
  assert.equal(denied.status, 403);
  const response = await fetch(url, { headers: { authorization: 'Bearer owner-test' } });
  assert.equal(response.headers.get('x-frame-seq'), '2');
  assert.equal(response.headers.get('x-frame-pts'), String(other.packets[1].ptsMs));
  assert.equal((await response.arrayBuffer()).byteLength, 5);
  other.failNext = true;
  await recorder.tick();
  assert.equal(preview.status().lastSeq, 3);
  assert.equal(other.packets.length, 2);
  assert.equal(recorder.status().state, 'degraded');
  assert.equal(recorder.status().outputs.bilibili.lastError, 'simulated output failure');
  await recorder.stopOutput('bilibili');
  assert.equal(recorder.status().state, 'running');
  await recorder.stop();
  assert.equal(recorder.status().state, 'stopped');
  assert.equal(openCount, 1);
  assert.equal(closeCount, 1);
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  child.stdin.write = () => true;
  child.stdin.end = () => child.emit('exit', 0);
  child.kill = () => {};
  const output = new BilibiliRtmpOutput({ target: `${root}/local.flv`, spawnImpl: () => child, stopTimeoutMs: 20 });
  await output.start();
  child.emit('spawn');
  await output.push({ ...frame(1, 1000), ptsMs: 0 });
  await output.push({ ...frame(2, 2000), ptsMs: 1000 });
  assert.equal(output.status().frames, 2);
  assert.equal(output.status().lastPtsMs, 1000);
  await output.stop();
  assert.equal(output.status().state, 'stopped');
  console.log('ok: SceneRecorder 统一帧号/PTS、同帧分发、独立输出、owner 预览与 FFmpeg 生命周期');
} finally {
  await recorder.stop().catch(() => {});
}
