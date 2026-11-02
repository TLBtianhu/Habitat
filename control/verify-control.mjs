// 控制面验收：AI 发起任务、无 token 拒绝批准、主人批准生效
const base = 'http://127.0.0.1:9240';
const fs = await import('node:fs');
const token = fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();

const t = await (await fetch(base + '/tasks', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'adapter.update', name: 'bilibili-adapter', version: '0.2.0' }),
})).json();
console.log('created', t.id, t.status);

const noAuth = await fetch(`${base}/tasks/${t.id}/approve`, { method: 'POST' });
console.log('noAuth status', noAuth.status);

const approved = await (await fetch(`${base}/tasks/${t.id}/approve`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` },
})).json();
console.log('approved', approved.status);

const s = await (await fetch(base + '/status')).json();
console.log('bilibili version', s.adapters.bilibili.version, 'status', s.adapters.bilibili.status);
