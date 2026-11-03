import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const root = process.argv[2] || process.env.HABITAT_INSTANCE_ROOT;
if (!root) throw new Error('instance root required');
const token = fs.readFileSync(path.join(root, 'config', 'owner.token'), 'utf8').trim();
const statusFile = path.join(root, 'data', 'instance-status.json');
const server = http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [] }));
    return;
  }
  if (req.url === '/rpc') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: {} }));
    return;
  }
  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'settings-test', object: 'chat.completion', created: 0, model: 'settings-test', choices: [{ index: 0, message: { role: 'assistant', content: '[]' }, finish_reason: 'stop' }] }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(18080, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:10240';
const request = async (method, pathName, body = undefined, authorized = true) => {
  const response = await fetch(base + pathName, {
    method,
    headers: { ...(authorized ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
};
const status = () => JSON.parse(fs.readFileSync(statusFile, 'utf8'));
const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const settings = (await request('GET', '/settings')).data;
    const current = status();
    if (predicate(settings, current)) return { settings, current };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timeout waiting for ' + description);
};
try {
  assert.equal((await request('GET', '/settings', undefined, false)).status, 403);
  const before = (await request('GET', '/settings')).data.apply.settingsRevision;
  const invalid = await request('POST', '/settings', { llm: { baseUrl: 'http://127.0.0.1:18081/v1', model: 'bad', apiKey: 'bad' } });
  assert.equal(invalid.status, 400);
  assert.equal((await request('GET', '/settings')).data.apply.settingsRevision, before);

  const valid = await request('POST', '/settings', {
    agent: true,
    llm: { baseUrl: 'http://127.0.0.1:18080/v1', model: 'settings-model-a', apiKey: 'settings-test-key' },
  });
  assert.equal(valid.status, 200, JSON.stringify(valid.data));
  const first = await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid, 'first agent apply');
  const firstPid = first.current.services.agent.pid;

  const changed = await request('POST', '/settings', { llm: { baseUrl: 'http://127.0.0.1:18080/v1', model: 'settings-model-b' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const second = await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid && current.services.agent.pid !== firstPid, 'model change restart');
  const secondPid = second.current.services.agent.pid;

  const disabled = await request('POST', '/settings', { agent: false });
  assert.equal(disabled.status, 200);
  await waitFor((settings, current) => settings.apply.state === 'applied' && !current.services?.agent, 'agent disable');

  const enabled = await request('POST', '/settings', { agent: true });
  assert.equal(enabled.status, 200);
  const third = await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid && current.services.agent.pid !== secondPid, 'agent re-enable');
  const thirdPid = third.current.services.agent.pid;

  const reapplied = await request('POST', '/settings/reapply', {});
  assert.equal(reapplied.status, 200);
  const reappliedState = await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid && current.services.agent.pid !== thirdPid, 'explicit reapply');
  const reapplyPid = reappliedState.current.services.agent.pid;

  const mcEnabled = await request('POST', '/settings', {
    applications: { mc: true },
    connections: { mc: { topology: 'local-wsl', serverAddress: '127.0.0.1:25565', rpcUrl: 'http://127.0.0.1:18080/rpc', token: 'mc-settings-test-token' } },
  });
  assert.equal(mcEnabled.status, 200, JSON.stringify(mcEnabled.data));
  const mcState = await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid && current.services.agent.pid !== reapplyPid, 'MC enable and RPC verification');
  const mcPid = mcState.current.services.agent.pid;
  const mcDisabled = await request('POST', '/settings', { applications: { mc: false } });
  assert.equal(mcDisabled.status, 200);
  await waitFor((settings, current) => settings.apply.state === 'applied' && current.services?.agent?.pid && current.services.agent.pid !== mcPid, 'MC disable restart');

  const publicSettings = (await request('GET', '/settings')).data;
  assert.equal(JSON.stringify(publicSettings).includes('settings-test-key'), false, 'secret returned by settings API');
  assert.equal(JSON.stringify(publicSettings).includes('mc-settings-test-token'), false, 'MC token returned by settings API');
  assert.equal(publicSettings.llm.model, 'settings-model-b');
  assert.equal(publicSettings.llm.apiKeySet, true);
  const stop = await request('POST', '/settings', { agent: false });
  assert.equal(stop.status, 200);
  await waitFor((settings, current) => settings.apply.state === 'applied' && !current.services?.agent, 'final agent disable');
  console.log('ok: settings API validation, live apply, model edit restart, disable/re-enable, reapply and secret redaction');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
