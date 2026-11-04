import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(process.cwd(), '.tmp', `auth-http-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const ownerFile = path.join(root, 'owner.token');
const agentFile = path.join(root, 'agent.token');
const napcatTokenFile = path.join(root, 'napcat.token');
fs.writeFileSync(ownerFile, 'owner-test');
fs.writeFileSync(agentFile, 'agent-test');
fs.writeFileSync(napcatTokenFile, 'secret-napcat-token', { mode: 0o600 });
let loggedIn = false;
let loginBody = '';
const webui = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/auth/login') {
    loginBody = body;
    res.end(JSON.stringify({ data: { Credential: 'credential-test' } }));
    return;
  }
  if (req.url === '/api/QQLogin/CheckLoginStatus') {
    res.end(JSON.stringify({ data: loggedIn }));
    return;
  }
  if (req.url === '/api/QQLogin/RefreshQRcode') {
    res.end(JSON.stringify({ data: { qrcodeurl: 'https://example.test/login?fresh=1' } }));
    return;
  }
  res.writeHead(404); res.end();
});
const webuiPort = 16000 + Math.floor(Math.random() * 1000);
const controlPort = 19000 + Math.floor(Math.random() * 1000);
await new Promise((resolve) => webui.listen(webuiPort, '127.0.0.1', resolve));
const control = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: {
    ...process.env,
    HABITAT_CONTROL_PORT: String(controlPort),
    HABITAT_NAPCAT_WEBUI_URL: `http://127.0.0.1:${webuiPort}/api`,
    HABITAT_NAPCAT_TOKEN_FILE: napcatTokenFile,
    HABITAT_OWNER_TOKEN_FILE: ownerFile,
    HABITAT_AGENT_TOKEN_FILE: agentFile,
    HABITAT_INSTANCE_ROOT: path.join(root, 'instance'),
    HABITAT_LIFECYCLE_FILE: path.join(root, 'lifecycle.json'),
    HABITAT_EPISODE_DIR: path.join(root, 'episodes'),
    HABITAT_MEMORY_DIR: path.join(root, 'memory'),
    HABITAT_AFTER_ACTION_FILE: path.join(root, 'after-action.jsonl'),
    HABITAT_SKILL_LIBRARY: path.join(root, 'skill-library.json'),
    HABITAT_SESSION_PATH: path.join(root, 'app-sessions.json'),
    HABITAT_CHAT_LOG: path.join(root, 'system-chat.jsonl'),
    HABITAT_PRESENCE_FILE: path.join(root, 'presence.json'),
    HABITAT_ONEBOT_STATUS_FILE: path.join(root, 'onebot-status.json'),
    HABITAT_SYSTEM_CHAT_PUMP: path.join(root, 'system-chat-pump.json'),
    HABITAT_TASKS_FILE: path.join(root, 'tasks.json'),
    HABITAT_CONTROL_OUTBOX: path.join(root, 'outbox.json'),
    HABITAT_PLUGIN_CACHE: path.join(root, 'plugins'),
    HABITAT_RESIDENCE_POLICY: path.join(root, 'policy.json'),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(pathname, { method = 'GET', owner = false } = {}) {
  const response = await fetch(`http://127.0.0.1:${controlPort}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner-test' } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}
try {
  for (let i = 0; i < 100; i++) {
    try { await api('/status'); break; } catch { await sleep(200); }
  }
  assert.equal((await api('/auth/status')).status, 403);
  assert.equal((await api('/auth/refresh', { method: 'POST' })).status, 403);
  const refreshed = await api('/auth/refresh', { method: 'POST', owner: true });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.state, 'awaiting_scan');
  assert.equal(refreshed.body.image.mimeType, 'image/png');
  assert.ok(refreshed.body.image.data.length > 1000);
  assert.equal(refreshed.headers.get('cache-control'), 'no-store');
  assert.equal(refreshed.body.checkedAt > 0, true);
  const text = JSON.stringify(refreshed.body);
  assert.equal(text.includes('secret-napcat-token'), false);
  assert.equal(text.includes('credential-test'), false);
  assert.equal(loginBody.includes('secret-napcat-token'), false);
  loggedIn = true;
  const ready = await api('/auth/status', { owner: true });
  assert.equal(ready.body.state, 'ready');
  assert.equal((await api('/auth/status?provider=other', { owner: true })).status, 400);
  const page = await fetch(`http://127.0.0.1:${controlPort}/console.html`);
  const html = await page.text();
  assert.ok(html.includes('data-tab="auth"'));
  assert.ok(html.includes('/auth/refresh'));
  assert.ok(html.includes('refresh-auth'));
  console.log('ok: owner-only auth.status/refresh、当前二维码、真实 ready、无秘密与 Login 页面');
} finally {
  control.kill();
  webui.close();
  fs.rmSync(root, { recursive: true, force: true });
}
