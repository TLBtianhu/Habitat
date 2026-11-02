import assert from 'node:assert/strict';
import { ChannelPolicy } from './residence-policy.mjs';

let now = 1000000;
const policy = new ChannelPolicy({
  now: () => now,
  ownerIds: [1],
  config: {
    version: 1,
    ownerIds: [1],
    residences: {
      'qq.group.123': { read: true, respond: 'addressed', tools: ['qq.reply'], rateLimitMs: 5000, memory: 'ephemeral', proactive: false },
      'qq.private.1': { read: true, respond: 'always', tools: ['qq.reply'], rateLimitMs: 2000, memory: 'residence', proactive: false },
    },
  },
});
const event = (text, user = 1, group = 123) => ({
  post_type: 'message', message_type: 'group', message_id: 1, self_id: 99,
  user_id: user, group_id: group, raw_message: text,
});
let context = policy.fromOneBot(event('hello'), 1);
assert.equal(context.residenceId, 'qq.group.123');
assert.equal(context.speakerRole, 'trusted', '群主不自动成为 Habitat owner');
assert.equal(context.addressed, false);
assert.equal(policy.evaluateInput(context).shouldRespond, false);

context = policy.fromOneBot(event('@大肥鱼 hello'), 2);
assert.equal(context.addressed, true);
assert.equal(policy.evaluateInput(context).shouldRespond, true);
assert.equal(policy.authorizeReply(context, { text: 'reply' }).route.peerId, '123');
assert.throws(() => policy.authorizeReply(context, { text: 'x', groupId: 456 }), /policy_bound/);
policy.noteOutput(context.residenceId);
assert.equal(policy.evaluateInput(context).shouldRespond, false, '限频必须生效');
now += 5001;
assert.equal(policy.evaluateInput(context).shouldRespond, true);
assert.equal(policy.canProactive(context), false);
assert.equal(policy.memoryScope(context).key, 'memory://qq/group/123');
assert.equal(policy.fromOneBot(event('@大肥鱼 hello'), 3).residenceId, context.residenceId, '重连不改变 residence');

const other = policy.fromOneBot(event('@大肥鱼 hello', 2, 456), 1);
assert.equal(policy.evaluateInput(other).shouldRespond, false, '未配置群默认只读');
assert.equal(policy.memoryScope(other).key, 'memory://qq/group/456');

const privateContext = policy.fromOneBot({
  post_type: 'message', message_type: 'private', message_id: 2,
  self_id: 99, user_id: 1, raw_message: 'hello',
}, 1);
assert.equal(privateContext.speakerRole, 'owner');
assert.equal(policy.authorizeReply(privateContext, { text: 'private reply' }).route.peerId, '1');
console.log('ok: ResidenceContext、addressed、owner/trusted、限频、记忆隔离、重连与目标绑定');
