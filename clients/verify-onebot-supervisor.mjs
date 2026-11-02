import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OneBotConnectionSupervisor } from './onebot-supervisor.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
function factory() {
  const client = new EventEmitter();
  client.close = () => client.emit('close', 1000, '');
  client.terminate = () => {};
  clients.push(client);
  return client;
}

try {
  const supervisor = new OneBotConnectionSupervisor({
    wsUrl: 'ws://127.0.0.1:3002', accessToken: 'secret', clientFactory: factory, maxQueue: 2,
  });
  await supervisor.start();
  clients[0].emit('open');
  clients[0].emit('message', JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat' }));
  const message = (id, user = 200, group = 300) => JSON.stringify({
    post_type: 'message', message_type: 'group', message_id: id, self_id: 100,
    user_id: user, group_id: group, raw_message: 'hello', time: 1793580000,
  });
  clients[0].emit('message', message(1));
  clients[0].emit('message', message(1));
  clients[0].emit('message', message(2, 100));
  clients[0].emit('message', message(3, 201, 301));
  clients[0].emit('message', message(4, 202));
  const obs = supervisor.obs();
  assert.equal(obs.new.length, 2);
  assert.equal(obs.new[0].type, 'app.qq.message');
  assert.equal(obs.new[0].groupId, 300);
  assert.equal(obs.new[1].groupId, 301);
  assert.equal(supervisor.status().deadLetter, 1);
  supervisor.complete(obs.new.map((e) => e.id));
  assert.equal(supervisor.obs().new.length, 0);

  clients[0].emit('close', 1006, 'network');
  assert.ok(supervisor.status().attempt >= 1);
  await sleep(1400);
  clients[1].emit('open');
  assert.equal(supervisor.status().state, 'ready');
  supervisor.lastMessageAt = Date.now() - 100000;
  supervisor.checkHealth();
  assert.equal(supervisor.status().lastError, 'heartbeat timeout');
  await supervisor.stop();
  await supervisor.stop();
  assert.equal(supervisor.status().state, 'stopped');
  assert.equal(JSON.stringify(supervisor.status()).includes('secret'), false);

  const auth = new OneBotConnectionSupervisor({ wsUrl: 'ws://127.0.0.1:3002', clientFactory: factory });
  await auth.start();
  clients[2].emit('open');
  clients[2].emit('close', 1008, 'invalid token');
  assert.equal(auth.status().state, 'auth_required');
  assert.equal(auth.status().nextRetryAt, 0);
  await auth.stop();
  console.log('ok: OneBot 心跳、消息去重、自消息过滤、背压、重连、认证失败与停止');
} finally {
  // 所有测试连接均已停止。
}
