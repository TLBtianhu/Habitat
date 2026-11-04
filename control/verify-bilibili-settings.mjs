import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(process.cwd(), '.tmp', `bilibili-settings-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const ownerFile = path.join(root, 'owner.token');
const agentFile = path.join(root, 'agent.token');
const napcatFile = path.join(root, 'napcat.token');
const configFile = path.join(root, 'bilibili-live.json');
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
fs.writeFileSync(napcatFile, 'napcat-test');
const port = 23000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: String(port),
    HABITAT_BILIBILI_LIVE_CONFIG: configFile,
    HABITAT_SCENE_PREVIEW_PORT: '0',
    HABITAT_NAPCAT_TOKEN_FILE: napcatFile,
    HABITAT_OWNER_TOKEN_FILE: ownerFile,
    HABITAT_AGENT_TOKEN_FILE: agentFile,
    HABITAT_INSTANCE_ROOT: path.join(root, 'instance'),
    HABITAT_LIFECYCLE_FILE: path.join(root, 'lifecycle.json'),
    HABITAT_EPISODE_DIR: path.join(root, 'episodes'),
    HABITAT_MEMORY_DIR: path.join(root, 'memory'),
    HABITAT_AFTER_ACTION_FILE: path.join(root, 'after.jsonl'),
    HABITAT_SKILL_LIBRARY: path.join(root, 'skill.json'),
    HABITAT_SESSION_PATH: path.join(root, 'sessions.json'),
    HABITAT_CHAT_LOG: path.join(root, 'chat.jsonl'),
    HABITAT_PRESENCE_FILE: path.join(root, 'presence.json'),
    HABITAT_ONEBOT_STATUS_FILE: path.join(root, 'onebot.json'),
    HABITAT_SYSTEM_CHAT_PUMP: path.join(root, 'pump.json'),
    HABITAT_TASKS_FILE: path.join(root, 'tasks.json'),
    HABITAT_CONTROL_OUTBOX: path.join(root, 'outbox.json'),
    HABITAT_PLUGIN_CACHE: path.join(root, 'plugins'),
    HABITAT_ADAPTER_STATE_DIR: path.join(root, 'adapters'),
    HABITAT_RESIDENCE_POLICY: path.join(root, 'policy.json'),
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(pathname, { method = 'GET', owner = false, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner-test' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
try {
  for (let i = 0; i < 100; i++) {
    try { await api('/status'); break; } catch { await sleep(200); }
  }
  assert.equal((await api('/bilibili/live/settings')).status, 403);
  assert.equal((await api('/bilibili/live/settings', { owner: true })).body.state, 'unconfigured');
  assert.equal((await api('/bilibili/live/settings', { method: 'POST', owner: true, body: { rtmpUrl: 'http://127.0.0.1/live', streamKey: 'secret-key' } })).status, 400);
  const saved = await api('/bilibili/live/settings', { method: 'POST', owner: true, body: { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'secret-key' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.streamKeySet, true);
  assert.equal(saved.body.verified, false);
  assert.ok(!JSON.stringify(saved.body).includes('secret-key'));
  const preserved = await api('/bilibili/live/settings', { method: 'POST', owner: true, body: { rtmpUrl: 'rtmp://127.0.0.1/other', streamKey: '' } });
  assert.equal(preserved.body.configured, true);
  assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).streamKey, 'secret-key');
  assert.equal((await api('/bilibili/live/start', { method: 'POST' })).status, 403);
  assert.equal((await api('/bilibili/live/stop', { method: 'POST', owner: true })).body.bilibili.state, 'stopped');
  const html = await (await fetch(`http://127.0.0.1:${port}/console.html`)).text();
  assert.ok(html.includes('bili-url') && html.includes('bili-key') && html.includes('saveBilibiliLive') && html.includes('bilibiliLiveAction'));
  assert.ok(!html.includes('secret-key'));
  console.log('ok: B站 RTMP owner 配置、脱敏状态、非法地址拒绝与 Live 配置页');
} finally {
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
}
