// Identity Hub 验收：manifest 注册、离线/cookie 绑定、scope 签发与撤销
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 9238;
const BASE = `http://127.0.0.1:${PORT}`;
const proc = spawn('node', ['C:/Habitat/identity/hub.mjs'], {
  env: { ...process.env, FB_IDENTITY_PORT: String(PORT) }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 500));
const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

console.log('[1] manifest 自动注册');
const manifests = await (await fetch(BASE + '/identity/manifests')).json();
assert.ok(manifests.find((m) => m.client === 'qq'));
assert.ok(manifests.find((m) => m.client === 'mc'));
console.log('  ok');

console.log('[2] 离线 MC 绑定与 scope 签发');
const begin = await post('/identity/begin', { client: 'mc', provider: 'offline' });
assert.equal(begin.body.flow, 'offline');
const bound = await post('/identity/complete', { bindingId: begin.body.bindingId, fields: { username: 'Dafeiyu' } });
assert.equal(bound.body.status, 'bound');
const grant = await post('/identity/issue', { identityId: 'mc/main', scopes: ['mc.join', 'mc.chat'] });
assert.ok(grant.body.token);
const denied = await post('/identity/issue', { identityId: 'mc/main', scopes: ['live.push'] });
assert.equal(denied.status, 400);
console.log('  ok');

console.log('[3] cookie 绑定与只读测试');
const b2 = await post('/identity/begin', { client: 'live', provider: 'bilibili' });
const done2 = await post('/identity/complete', {
  bindingId: b2.body.bindingId, fields: { sessdata: 'secret-cookie' }, displayName: '大肥鱼',
});
assert.equal(done2.body.status, 'bound');
const test = await post('/identity/test', { identityId: 'live/bilibili' });
assert.equal(test.body.ok, true);
console.log('  ok');

console.log('[4] 注销后不再签发');
await post('/identity/revoke', { identityId: 'mc/main' });
const after = await post('/identity/issue', { identityId: 'mc/main', scopes: ['mc.join'] });
assert.equal(after.status, 400);
console.log('  ok');

await post('/shutdown', {});
await new Promise((r) => proc.once('exit', r));
console.log('Identity Hub 验收通过');
process.exit(0);
