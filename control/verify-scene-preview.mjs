import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(process.cwd(), '.tmp', `scene-preview-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const ownerFile = path.join(root, 'owner.token');
const agentFile = path.join(root, 'agent.token');
const napcatFile = path.join(root, 'napcat.token');
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
fs.writeFileSync(napcatFile, 'napcat-test');
let seq = 0;
let opened = 0;
const desktop = http.createServer((req, res) => {
  if (req.url === '/capture/open') {
    opened += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'capture-test', captureToken: 'capture-token' }));
    return;
  }
  if (req.url === '/capture/frame?id=capture-test') {
    seq += 1;
    res.writeHead(200, { 'content-type': 'image/png', 'x-frame-seq': String(seq), 'x-frame-at': String(1000 + seq) });
    res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
    return;
  }
  if (req.url === '/capture/close') { res.end('{}'); return; }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => desktop.listen(0, '127.0.0.1', resolve));
const desktopPort = desktop.address().port;
const controlPort = 19000 + Math.floor(Math.random() * 1000);
const control = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: String(controlPort),
    FB_DESKTOP_URL: `http://127.0.0.1:${desktopPort}`,
    HABITAT_SCENE_PREVIEW_PORT: '0',
    HABITAT_BILIBILI_LIVE_CONFIG: path.join(root, 'bilibili-live.json'),
    HABITAT_STREAM_POLICY_FILE: path.join(root, 'stream-policy.json'),
    HABITAT_STREAM_SCHEDULER_FILE: path.join(root, 'stream-scheduler.json'),
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
async function api(pathname, { method = 'GET', owner = false } = {}) {
  const response = await fetch(`http://127.0.0.1:${controlPort}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner-test' } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}
try {
  for (let i = 0; i < 100; i++) {
    try { await api('/status'); break; } catch { await sleep(200); }
  }
  assert.equal((await api('/scene/status')).status, 403);
  assert.equal((await api('/scene/preview/start', { method: 'POST' })).status, 403);
  const started = await api('/scene/preview/start', { method: 'POST', owner: true });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.preview.state, 'running');
  assert.ok(started.body.preview.url);
  const frame = await fetch(started.body.preview.url, { headers: { authorization: 'Bearer owner-test' } });
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get('x-frame-seq'), '1');
  assert.ok(Number(frame.headers.get('x-frame-pts')) >= 0);
  assert.equal((await frame.arrayBuffer()).byteLength, 8);
  const sameOrigin = await fetch(`http://127.0.0.1:${controlPort}/scene/frame`, { headers: { authorization: 'Bearer owner-test' } });
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.headers.get('content-type'), 'image/png');
  assert.equal(sameOrigin.headers.get('x-frame-seq'), '1');
  assert.equal((await api('/scene/preview/stop', { method: 'POST', owner: true })).body.preview.state, 'stopped');
  const restarted = await api('/scene/preview/start', { method: 'POST', owner: true });
  assert.equal(restarted.body.preview.state, 'running');
  assert.ok(opened >= 1);
  await api('/scene/preview/stop', { method: 'POST', owner: true });
  const html = await (await fetch(`http://127.0.0.1:${controlPort}/console.html`)).text();
  assert.ok(html.includes('/scene/status'));
  assert.ok(html.includes('scenePreviewAction'));
  assert.ok(html.includes('/scene/preview/'));
  console.log('ok: owner 预览启停、统一帧图像授权、重启与 Live 页面');
} finally {
  control.kill();
  desktop.close();
  fs.rmSync(root, { recursive: true, force: true });
}
