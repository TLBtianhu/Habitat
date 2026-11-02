import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 9242;
const BASE = `http://127.0.0.1:${PORT}`;
const FILE = `/tmp/habitat-control-tasks-test-${process.pid}.json`;
const OWNER = fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();
const entry = new URL('./server.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let proc;

async function start() {
  proc = spawn(process.execPath, [entry], {
    env: { ...process.env, HABITAT_CONTROL_PORT: String(PORT), HABITAT_TASKS_FILE: FILE },
    stdio: 'ignore',
  });
  await sleep(350);
}
async function stop() {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  await exited;
}
async function api(path, body = null, owner = false) {
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: `Bearer ${OWNER}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
try {
  await start();
  const task = await api('/tasks', { type: 'adapter.update', name: 'persistence-test', version: '1.0.0' });
  assert.equal(task.id, 1);
  const approved = await api(`/tasks/${task.id}/approve`, {}, true);
  assert.equal(approved.status, 'approved');
  await stop();

  await start();
  const tasks = await api('/tasks');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'approved');
  const second = await api('/tasks', { type: 'adapter.update', name: 'persistence-test-2', version: '1.0.0' });
  assert.equal(second.id, 2, '重启后 id 必须继续递增');
  await stop();
  console.log('ok: 任务状态与 nextId 在控制面重启后保留');
} finally {
  await stop();
  try { fs.rmSync(FILE, { force: true }); } catch {}
}
