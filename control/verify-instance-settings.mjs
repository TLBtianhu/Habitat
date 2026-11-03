import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { InstanceSettings } from './instance-settings.mjs';

const root = `/tmp/habitat-settings-test-${process.pid}`;
const configDir = path.join(root, 'config');
fs.mkdirSync(configDir, { recursive: true });
const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.includes('invalid')) return new Response('{}', { status: 503 });
  if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  if (url.endsWith('/get_login_info')) return new Response(JSON.stringify({ retcode: 0, status: 'ok', data: {} }), { status: 200 });
  if (url.includes('api.live.bilibili.com')) return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
  throw new Error('unexpected test URL');
};
const settings = new InstanceSettings({ root, fetchImpl });
try {
  await assert.rejects(settings.save({ llm: { baseUrl: 'https://invalid.example/v1', model: 'test', apiKey: 'secret-key' } }));
  assert.equal(fs.existsSync(path.join(configDir, 'instance.json')), false, '校验失败不得写配置');

  const saved = await settings.save({
    agent: true,
    llm: { baseUrl: 'http://127.0.0.1:18080/v1', model: 'test-model', apiKey: 'secret-key' },
    applications: { qq: true, bilibili: true, mc: false },
    connections: {
      qq: { wsUrl: 'ws://127.0.0.1:3002', httpUrl: 'http://127.0.0.1:3003', token: 'qq-secret' },
      bilibili: { roomId: 123, cookie: 'bili-secret' },
    },
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.apply.state, 'pending');
  const publicSettings = settings.get();
  const serialized = JSON.stringify(publicSettings);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(serialized.includes('qq-secret'), false);
  assert.equal(serialized.includes('bili-secret'), false);
  assert.equal(publicSettings.llm.apiKeySet, true);
  assert.equal(publicSettings.connections.qq.tokenSet, true);
  assert.equal(publicSettings.connections.bilibili.cookieSet, true);
  const revision = publicSettings.apply.settingsRevision;
  await assert.rejects(settings.save({ applications: { mc: true } }));
  assert.equal(settings.get().apply.settingsRevision, revision, '失败的应用开关不得推进配置修订');
  const reapplied = await settings.save({ reapply: true });
  assert.equal(reapplied.apply.settingsRevision, revision + 1);
  console.log('ok: 设置校验、原子保存、脱敏读取、失败不生效与重新应用');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
