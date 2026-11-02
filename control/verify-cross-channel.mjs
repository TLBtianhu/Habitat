import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CrossChannelTasks } from './cross-channel.mjs';
import { ChannelPolicy } from '../agent/residence-policy.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';

const sent = [];
const onebotClient = {
  sendGroupMsg: async (id, text) => { sent.push({ kind: 'group', id, text }); return { message_id: 1 }; },
  sendPrivateMsg: async (id, text) => { sent.push({ kind: 'private', id, text }); return { message_id: 2 }; },
};
const policy = new ChannelPolicy({ config: {
  version: 1,
  residences: {
    'qq.group.123': { read: true, tools: ['qq.reply'], rateLimitMs: 5000 },
    'qq.private.1': { read: true, tools: ['qq.reply'], rateLimitMs: 2000 },
  },
} });
const file = `/tmp/habitat-cross-channel-test-${process.pid}.json`;
const afterFile = `/tmp/habitat-cross-after-${process.pid}.jsonl`;
const afterAction = new AfterActionStore({ file: afterFile });
const tasks = new CrossChannelTasks({ policy, onebotClient, outboxFile: file, afterAction });
const task = (id, target, status = 'approved') => ({
  id, type: 'cross_channel.message', sourceResidenceId: 'system', targetResidenceId: target,
  text: 'hello', status,
});

try {
  const first = await tasks.execute(task(1, 'qq.group.123'));
  assert.equal(first.targetResidenceId, 'qq.group.123');
  const second = await tasks.execute(task(1, 'qq.group.123'));
  assert.equal(second.deduped, true);
  assert.equal(sent.length, 1);
  assert.equal(afterAction.list({ residenceId: 'qq.group.123' }).length, 1, '重复执行不能重复记复盘');
  assert.equal(afterAction.list({ residenceId: 'qq.group.123' })[0].verification.outcome, 'verified_success');
  await assert.rejects(() => tasks.execute(task(2, 'qq.group.123', 'pending')), /not_approved/);
  await assert.rejects(() => tasks.execute(task(3, 'qq.group.456')), /qq.reply_not_allowed/);
  assert.equal(afterAction.list({ residenceId: 'qq.group.456' })[0].verification.outcome, 'verified_failure');
  await assert.rejects(() => tasks.execute({ ...task(4, 'qq.group.123'), sourceResidenceId: 'qq.group.123' }), /requires_system_owner/);
  await tasks.execute(task(5, 'qq.private.1'));
  assert.equal(sent.at(-1).kind, 'private');
  await assert.rejects(() => tasks.execute(task(6, 'qq.private.1')), /rate_limited/);
  console.log('ok: owner-approved 跨频道任务、目标复核、幂等、拒绝未批准/跨群/限频');
} finally {
  fs.rmSync(file, { force: true });
  fs.rmSync(afterFile, { force: true });
}
