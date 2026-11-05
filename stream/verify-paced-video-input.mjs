import assert from 'node:assert/strict';
import { PacedVideoInput } from './paced-video-input.mjs';
import { createStandbyFrame } from './standby-frame.mjs';

let now = 0;
const writes = [];
const errors = [];
const input = new PacedVideoInput({
  fps: 10,
  now: () => now,
  standbyFrame: Buffer.from([0]),
  write: async (data) => { writes.push({ data: [...data], at: now }); },
  onError: (error) => errors.push(error.message),
});
input.start();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(input.status().writtenFrames, 1, '没有源帧时也允许明确待机帧');
assert.equal(input.status().standbyFrames, 1);

input.offer({ seq: 1, capturedAt: 0, ptsMs: 0, data: Buffer.from([1]) });
now = 100;
await input.tick();
assert.equal(writes.at(-1).data[0], 1);
assert.equal(input.status().duplicatedFrames, 0);
now = 200;
await input.tick();
assert.equal(writes.at(-1).data[0], 1);
assert.equal(input.status().duplicatedFrames, 1, '同一最新帧可以重复维持输出节奏');

now = 1100;
input.offer({ seq: 2, capturedAt: 1100, ptsMs: 1100, data: Buffer.from([2]) });
await input.tick();
assert.equal(writes.at(-1).data[0], 2);
now = 4000;
await input.tick();
assert.equal(writes.at(-1).data[0], 0, '过期帧必须切到明确待机帧');
assert.ok(input.status().standbyFrames >= 2);
assert.ok(input.status().lastFrameAgeMs > 2500);

const beforeSlow = input.status().writtenFrames;
now = 10000;
await input.tick();
assert.equal(input.status().writtenFrames, beforeSlow + 1, '落后时不能爆发式补写历史帧');
assert.ok(input.status().droppedFrames > 0);
input.stop();
const stoppedWrites = input.status().writtenFrames;
now = 10100;
await input.tick();
assert.equal(input.status().writtenFrames, stoppedWrites);
assert.deepEqual(errors, []);

const png = createStandbyFrame(16, 16);
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(png.readUInt32BE(16), 16);
assert.equal(png.readUInt32BE(20), 16);
console.log('ok: 墙钟帧节奏、最新帧去重、过期待机、背压丢弃与停止清理');
