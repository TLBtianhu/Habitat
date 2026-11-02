import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DurableEventPump } from './durable-event-pump.mjs';

const file = `/tmp/habitat-event-pump-test-${process.pid}.json`;
const other = `/tmp/habitat-event-pump-backoff-${process.pid}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of [file, other]) { try { fs.rmSync(f, { force: true }); } catch {} }
const events = [];
const read = async () => events;

try {
  const first = new DurableEventPump({ source: 'system', read, stateFile: file, pollIntervalMs: 5, maxQueue: 2 });
  await first.start();
  events.push({ id: 1, from: 'owner', text: 'hello', at: 1 });
  await sleep(20);
  assert.deepEqual(first.obs().new.map((e) => e.id), [1]);
  first.complete([1]);
  await sleep(10);
  assert.equal(first.obs().new.length, 0);

  const second = new DurableEventPump({ source: 'system', read, stateFile: file, pollIntervalMs: 5, maxQueue: 2 });
  await second.start();
  assert.equal(second.obs().new.length, 0, '重启不得重复处理完成事件');
  events.push({ id: 2, from: 'owner', text: 'offline', at: 2 });
  await sleep(20);
  assert.deepEqual(second.obs().new.map((e) => e.id), [2]);

  const third = new DurableEventPump({ source: 'system', read, stateFile: file, pollIntervalMs: 5, maxQueue: 2 });
  await third.start();
  assert.deepEqual(third.obs().new.map((e) => e.id), [2], '未处理事件在重启后仍需补收');
  third.complete([2]);
  await sleep(10);
  assert.equal(third.obs().new.length, 0);

  events.push({ id: 3, from: 'dafeiyu', text: 'self', at: 3 });
  await sleep(15);
  assert.equal(third.obs().new.length, 0, '自己的消息不能触发自回复');

  events.push(
    { id: 4, from: 'owner', text: 'q4', at: 4 },
    { id: 5, from: 'owner', text: 'q5', at: 5 },
    { id: 6, from: 'owner', text: 'q6', at: 6 },
  );
  await sleep(20);
  assert.equal(third.obs().new.length, 2, '有界队列必须生效');
  assert.equal(third.status().deadLetter, 1, '超限必须显式进入 dead-letter，不能静默丢弃');
  await third.stop();
  await third.stop();

  const before = third.status().watermark;
  await third.start();
  events.length = 0;
  events.push({ id: 1, from: 'owner', text: 'reset', at: 7 });
  await sleep(15);
  assert.ok(third.status().watermark <= before, '控制面重置后水位必须重建');
  assert.equal(third.obs().new.length, 0);

  let fail = true;
  const flakyRead = async () => {
    if (fail) { fail = false; throw new Error('offline'); }
    return [];
  };
  const flaky = new DurableEventPump({ source: 'system', read: flakyRead, stateFile: other, pollIntervalMs: 5 });
  await flaky.start();
  assert.ok(flaky.status().reconnectAttempt >= 1);
  assert.ok(flaky.status().nextRetryAt > Date.now(), '失败必须指数退避而不是紧密重试');
  await sleep(10);
  assert.equal(flaky.status().lastError, null);
  assert.equal(flaky.status().reconnectAttempt, 0);
  await flaky.stop();
  await first.stop();
  await second.stop();
  await third.stop();
  console.log('ok: 持久化去重、重启补收、自消息过滤、背压死信、退避与水位恢复');
} finally {
  for (const f of [file, other]) { try { fs.rmSync(f, { force: true }); } catch {} }
}
