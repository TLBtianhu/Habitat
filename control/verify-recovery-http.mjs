import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EpisodeStore } from '../agent/episode-store.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';

const dir = `/tmp/habitat-recovery-http-${process.pid}`;
fs.mkdirSync(dir, { recursive: true });
const ownerFile = `${dir}/owner.token`;
const agentFile = `${dir}/agent.token`;
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
fs.writeFileSync(`${dir}/policy.json`, JSON.stringify({ version: 1, residences: {} }));
const episodeStore = new EpisodeStore({ root: `${dir}/episodes` });
const episode = episodeStore.create({ id: 'live-current', goal: 'http recovery', participants: ['system'] });
const write = episode.addPendingWrite('demo.action', { args: {}, residenceId: 'system' });
episodeStore.save(episode);
new AfterActionStore({ file: `${dir}/after.jsonl` }).record({
  taskId: write.id,
  residenceId: 'system',
  goal: 'demo.action',
  checks: [{ name: 'persisted', ok: true, evidence: 'confirmed' }],
});
fs.writeFileSync(`${dir}/lifecycle.json`, JSON.stringify({ schemaVersion: 1, bootId: 1, state: 'running', lastShutdownAbnormal: true, recoveryRequired: true }));
const proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: '9255',
    HABITAT_LIFECYCLE_FILE: `${dir}/lifecycle.json`,
    HABITAT_EPISODE_DIR: `${dir}/episodes`,
    HABITAT_AFTER_ACTION_FILE: `${dir}/after.jsonl`,
    HABITAT_SKILL_LIBRARY: `${dir}/skills.json`,
    HABITAT_OWNER_TOKEN_FILE: ownerFile,
    HABITAT_AGENT_TOKEN_FILE: agentFile,
    HABITAT_ADAPTER_STATE_DIR: `${dir}/adapters`,
    HABITAT_CONTROL_OUTBOX: `${dir}/outbox.json`,
    HABITAT_TASKS_FILE: `${dir}/tasks.json`,
    HABITAT_RESIDENCE_POLICY: `${dir}/policy.json`,
  },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, owner = false) {
  const response = await fetch('http://127.0.0.1:9255' + path, {
    method: path === '/recovery' ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner-test' } : {}) },
    body: path === '/recovery' ? '{}' : undefined,
  });
  return { status: response.status, body: await response.json() };
}
try {
  for (let i = 0; i < 60; i++) {
    try { await fetch('http://127.0.0.1:9255/status'); break; } catch { await sleep(200); }
  }
  assert.equal((await api('/lifecycle')).body.recoveryRequired, true);
  assert.equal((await api('/recovery')).status, 403);
  const recovered = await api('/recovery', true);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.recoveryRequired, false);
  assert.equal(episodeStore.get('live-current').pendingWrites[0].status, 'confirmed');
  console.log('ok: /lifecycle 异常状态、/recovery owner 授权与只读恢复');
} finally {
  if (proc.exitCode === null && !proc.signalCode) {
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
