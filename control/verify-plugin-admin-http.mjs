import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = `/tmp/habitat-plugin-admin-${process.pid}`;
const cacheDir = `${dir}/plugins`;
const installed = `${cacheDir}/installed`;
const ownerFile = `${dir}/owner.token`;
const agentFile = `${dir}/agent.token`;
fs.mkdirSync(installed, { recursive: true });
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
fs.writeFileSync(`${installed}/qq.install.json`, JSON.stringify({ id: 'qq', version: '0.1.1', hash: 'a'.repeat(64), enabled: true }));
fs.writeFileSync(`${dir}/policy.json`, JSON.stringify({ version: 1, residences: {} }));
const proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: '9254',
    HABITAT_PLUGIN_CACHE: cacheDir,
    HABITAT_OWNER_TOKEN_FILE: ownerFile,
    HABITAT_AGENT_TOKEN_FILE: agentFile,
    HABITAT_ADAPTER_STATE_DIR: `${dir}/adapters`,
    HABITAT_AFTER_ACTION_FILE: `${dir}/after.jsonl`,
    HABITAT_CONTROL_OUTBOX: `${dir}/outbox.json`,
    HABITAT_TASKS_FILE: `${dir}/tasks.json`,
    HABITAT_RESIDENCE_POLICY: `${dir}/policy.json`,
  },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, body = null, owner = true) {
  const response = await fetch('http://127.0.0.1:9254' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner-test' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
try {
  for (let i = 0; i < 60; i++) {
    try { await fetch('http://127.0.0.1:9254/status'); break; } catch { await sleep(200); }
  }
  assert.equal((await api('/plugins/disable', { id: 'qq' }, false)).status, 403);
  assert.equal((await api('/plugins/disable', { id: 'qq' })).body.enabled, false);
  assert.equal((await api('/plugins/enable', { id: 'qq' })).body.enabled, true);
  assert.equal((await api('/plugins/revoke', { id: 'qq' })).body.revoked, true);
  assert.equal((await api('/plugins/enable', { id: 'qq' })).status, 400);
  assert.equal((await api('/plugins/unrevoke', { id: 'qq' })).body.enabled, false);
  assert.equal((await api('/plugins/enable', { id: 'qq' })).body.enabled, true);
  assert.equal((await api('/plugins/uninstall', { id: 'qq' })).body.uninstalled, true);
  assert.deepEqual((await api('/plugins/index')).body, []);
  console.log('ok: Control owner 停用、启用、撤销、解除撤销与卸载');
} finally {
  if (proc.exitCode === null && !proc.signalCode) {
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
