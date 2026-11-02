import assert from 'node:assert/strict';
import { createHandlers } from './provider.mjs';
import { ChannelPolicy } from '../../agent/residence-policy.mjs';

const sent = [];
const onebotClient = {
  sendGroupMsg: async (id, text) => { sent.push({ kind: 'group', id, text }); return { message_id: 1 }; },
  sendPrivateMsg: async (id, text) => { sent.push({ kind: 'private', id, text }); return { message_id: 2 }; },
};
const policy = new ChannelPolicy({ config: {
  version: 1,
  ownerIds: [1],
  residences: {
    'qq.group.123': { respond: 'addressed', tools: ['qq.reply'], rateLimitMs: 5000 },
    'qq.private.1': { respond: 'always', tools: ['qq.reply'], rateLimitMs: 2000 },
  },
} });
let current = null;
const handlers = createHandlers({ onebotClient, policy, getResidenceContext: () => current });
const event = (text, user = 1, group = 123) => ({
  post_type: 'message', message_type: 'group', self_id: 99,
  user_id: user, group_id: group, raw_message: text,
});

current = policy.fromOneBot(event('@大肥鱼 hello'));
await handlers.reply({ text: 'ok' });
assert.deepEqual(sent[0], { kind: 'group', id: 123, text: 'ok' });
await assert.rejects(() => handlers.reply({ text: 'again' }), /rate_limited/);

current = policy.fromOneBot(event('not addressed'));
await assert.rejects(() => handlers.reply({ text: 'no' }), /not_addressed/);
current = null;
await assert.rejects(() => handlers.reply({ text: 'no target' }), /reply_requires_qq_residence/);
current = policy.fromOneBot(event('@大肥鱼 hi', 1, 456));
await assert.rejects(() => handlers.reply({ text: 'wrong group' }), /not_addressed|reply_disabled/);
current = policy.fromOneBot({ post_type: 'message', message_type: 'private', self_id: 99, user_id: 1, raw_message: 'private' });
await handlers.reply({ text: 'private ok' });
assert.deepEqual(sent.at(-1), { kind: 'private', id: 1, text: 'private ok' });
console.log('ok: qq.reply 仅回来源 residence，拒绝未授权、未 addressed、无目标和跨群发送');
