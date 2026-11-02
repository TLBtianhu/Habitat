import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const PORT = 9273;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = `/tmp/habitat-outlet-supervisor-test-${process.pid}`;
const AGENT = fs.readFileSync('/etc/habitat/agent.token', 'utf8').trim();
const entry = new URL('./outlet-supervisor.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(DIR, { recursive: true });
let supervisor;

async function api(path, body = null, token = AGENT) {
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function startSupervisor(extra = {}) {
  supervisor = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      HABITAT_OUTLET_PORT: String(PORT),
      HABITAT_OUTLET_STATE_DIR: DIR,
      HABITAT_TEST_HLS_ENTRY: '../tools/test-outlet-child.sh',
      ...extra,
    },
    stdio: 'ignore',
  });
  await sleep(400);
}
async function stopSupervisor() {
  if (!supervisor || supervisor.exitCode !== null) return;
  supervisor.kill('SIGTERM');
  await new Promise((r) => supervisor.once('exit', r));
}

try {
  await startSupervisor();
  assert.equal((await api('/outlets/start', { name: 'hls' }, 'bad')).status, 403);
  const first = await api('/outlets/start', { name: 'hls' });
  assert.equal(first.data.accepted, true);
  assert.equal(first.data.state, 'starting');
  const instanceId = first.data.instanceId;
  await sleep(150);
  const second = await api('/outlets/start', { name: 'hls' });
  assert.equal(second.data.already, true);
  assert.equal(second.data.instanceId, instanceId, '重复启动必须返回同一实例');
  assert.equal((await api('/status')).data.hls.running, true);

  const stopped = await api('/outlets/stop', { name: 'hls' });
  assert.equal(stopped.data.stopped, true);
  assert.equal(stopped.data.instanceId, instanceId);
  assert.equal((await api('/status')).data.hls.running, false);
  assert.equal((await api('/outlets/stop', { name: 'hls' })).data.alreadyStopped, true);
  await stopSupervisor();

  // 旧状态只能标为 interrupted，不得根据伪 PID 做任何 kill。
  fs.writeFileSync(`${DIR}/hls.json`, JSON.stringify({ instanceId: 'old', pid: 999999, state: 'running', startedAt: Date.now() - 1000 }));
  await startSupervisor();
  assert.equal((await api('/status')).data.hls.state, 'interrupted');
  await stopSupervisor();

  await startSupervisor({ TEST_IGNORE_SIGTERM: '1' });
  await api('/outlets/start', { name: 'hls' });
  await sleep(150);
  const t0 = performance.now();
  const killed = await api('/outlets/stop', { name: 'hls' });
  console.log('stop elapsed', Date.now() - t0, killed.data);
  assert.equal(killed.data.stopped, true, 'SIGTERM 无效时升级 SIGKILL 后必须确认退出');
  assert.ok(performance.now() - t0 >= 4500, '停止必须等待真实退出，而不是立即返回');
  await stopSupervisor();
  console.log('ok: supervisor 实例唯一、退出确认、超时升级、旧 PID 不误杀');
} finally {
  await stopSupervisor();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
}
