import assert from 'node:assert/strict';
import { BiliConnectionSupervisor } from './bilibili-supervisor.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
const realNow = Date.now;
function factory({ onEvent }) {
  const client = {
    connect: async () => { setTimeout(() => onEvent({ type: 'open' }), 0); },
    close: () => { setTimeout(() => onEvent({ type: 'close' }), 0); },
    emit: onEvent,
  };
  clients.push(client);
  return client;
}

try {
  const supervisor = new BiliConnectionSupervisor({ roomId: 1, cookie: 'secret', clientFactory: factory, idleTimeoutMs: 30 });
  await supervisor.start();
  await sleep(10);
  const client = clients[0];
  const baseTime = realNow();
  Date.now = () => baseTime;
  client.emit({ type: 'danmaku', user: 'alice', text: 'hello' });
  Date.now = () => baseTime + 1001;
  client.emit({ type: 'danmaku', user: 'alice', text: 'hello' });
  client.emit({ type: 'danmaku', user: 'bob', text: 'hello' });
  Date.now = realNow;
  const obs = supervisor.obs();
  assert.equal(obs.new.length, 2, '同秒重复帧去重，不同用户不合并');
  assert.equal(obs.new[0].type, 'app.bilibili.danmaku');
  assert.equal(obs.available, true);

  supervisor.complete(obs.new.map((e) => e.id));
  assert.equal(supervisor.obs().new.length, 0);

  client.emit({ type: 'close' });
  await sleep(10);
  assert.ok(supervisor.status().attempt >= 1);
  assert.ok(supervisor.status().nextRetryAt > Date.now());
  await sleep(1400);
  assert.equal(supervisor.status().state, 'ready');

  supervisor.lastMessageAt = Date.now() - 1000;
  supervisor.checkHealth();
  assert.ok(supervisor.status().lastError.includes('heartbeat') || supervisor.status().attempt >= 1);
  await supervisor.stop();
  await supervisor.stop();
  assert.equal(supervisor.status().state, 'stopped');
  assert.equal(JSON.stringify(supervisor.status()).includes('secret'), false);
  console.log('ok: B站连接开/关、有限去重、重连、心跳超时与停止');
} finally {
  Date.now = realNow;
  // 测试中的客户端均已关闭；不保留重连定时器。
}
