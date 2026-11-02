import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ownerFile = `/tmp/habitat-cross-owner-${process.pid}.token`;
const agentFile = `/tmp/habitat-cross-agent-${process.pid}.token`;
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
const OWNER = fs.readFileSync(ownerFile, 'utf8').trim();
const tasksFile = `/tmp/habitat-cross-http-tasks-${process.pid}.json`;
const outboxFile = `/tmp/habitat-cross-http-outbox-${process.pid}.json`;
const afterFile = `/tmp/habitat-cross-http-after-${process.pid}.jsonl`;
const policyFile = `/tmp/habitat-cross-http-policy-${process.pid}.json`;
fs.writeFileSync(policyFile, JSON.stringify({
  version: 1,
  residences: {
    'qq.group.123': { read: true, tools: ['qq.reply'], rateLimitMs: 5000 },
    'qq.private.1': { read: true, tools: ['qq.reply'], rateLimitMs: 2000 },
  },
}));
let calls = 0;
const fake = http.createServer((req, res) => {
  if (req.url === '/send_group_msg' || req.url === '/send_private_msg') {
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 42 } }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => fake.listen(3004, '127.0.0.1', r));
const proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: '9243',
    HABITAT_TASKS_FILE: tasksFile,
    HABITAT_CONTROL_OUTBOX: outboxFile,
    HABITAT_RESIDENCE_POLICY: policyFile,
    HABITAT_ONEBOT_HTTP_URL: 'http://127.0.0.1:3004',
    HABITAT_AFTER_ACTION_FILE: afterFile,
    HABITAT_OWNER_TOKEN_FILE: ownerFile,
    HABITAT_AGENT_TOKEN_FILE: agentFile,
    HABITAT_ADAPTER_STATE_DIR: `/tmp/habitat-cross-adapters-${process.pid}`,
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body, owner = true) {
  const r = await fetch('http://127.0.0.1:9243' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: `Bearer ${OWNER}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
try {
  for (let i = 0; i < 60; i++) {
    try { await fetch('http://127.0.0.1:9243/status'); break; } catch { await sleep(200); }
  }
  const denied = await post('/tasks', { type: 'cross_channel.message', targetResidenceId: 'qq.group.123', text: 'hello' }, false);
  assert.equal(denied.status, 403);
  const created = await post('/tasks', { type: 'cross_channel.message', targetResidenceId: 'qq.group.123', text: 'hello' });
  assert.equal(created.body.status, 'pending');
  const approved = await post(`/tasks/${created.body.id}/approve`, {});
  assert.equal(approved.body.status, 'succeeded');
  assert.equal(approved.body.result.targetResidenceId, 'qq.group.123');
  const repeated = await post(`/tasks/${created.body.id}/approve`, {});
  assert.equal(repeated.status, 409);
  assert.equal(calls, 1);
  const second = await post('/tasks', { type: 'cross_channel.message', targetResidenceId: 'qq.group.123', text: 'again' });
  const limited = await post(`/tasks/${second.body.id}/approve`, {});
  assert.equal(limited.body.status, 'failed');
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal(calls, 1);
  const other = await post('/tasks', { type: 'cross_channel.message', targetResidenceId: 'qq.group.456', text: 'wrong' });
  const otherResult = await post(`/tasks/${other.body.id}/approve`, {});
  assert.equal(otherResult.body.status, 'failed');
  assert.equal(calls, 1);
  const privateTask = await post('/tasks', { type: 'cross_channel.message', targetResidenceId: 'qq.private.1', text: 'private' });
  const privateResult = await post(`/tasks/${privateTask.body.id}/approve`, {});
  assert.equal(privateResult.body.status, 'succeeded');
  assert.equal(calls, 2);
  const persisted = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  assert.equal(persisted.length, 4);
  assert.equal(fs.readFileSync(afterFile, 'utf8').split(/\r?\n/).filter(Boolean).length, 4, '成功、限频失败、目标失败与私聊成功各有复盘');
  console.log('ok: Control HTTP owner 创建/批准/执行、拒绝未授权、重复执行、限频与持久化');
} finally {
  proc.kill();
  fake.close();
  for (const f of [tasksFile, outboxFile, policyFile, afterFile, ownerFile, agentFile]) fs.rmSync(f, { force: true });
  fs.rmSync(`/tmp/habitat-cross-adapters-${process.pid}`, { recursive: true, force: true });
}
