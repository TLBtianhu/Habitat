// Identity Hub MVP：manifest 注册表 + 统一身份记录 + scope token
// 只保存 secretRef 与元数据，不在这里实现具体平台登录（那属于 provider 插件）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as deepseek from './providers/deepseek.mjs';
import * as bilibili from './providers/bilibili.mjs';
import * as mockqr from './providers/mockqr.mjs';

const PORT = Number(process.env.FB_IDENTITY_PORT || 9237);
const ROOT = process.env.FB_IDENTITY_ROOT || 'C:/Habitat/identity';
const STORE = process.env.FB_IDENTITY_STORE || 'C:/Habitat/artifacts/identities.json';

const manifests = new Map();
for (const name of fs.readdirSync(path.join(ROOT, 'manifests'))) {
  if (!name.endsWith('.json')) continue;
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', name), 'utf8'));
  manifests.set(`${m.client}/${m.provider}`, m);
}

let records = [];
try { records = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch {}
const bindings = new Map();
const tokens = new Map();

function save() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(records, null, 2));
}

function upsert(rec) {
  const i = records.findIndex((r) => r.identityId === rec.identityId);
  if (i >= 0) records[i] = rec; else records.push(rec);
  save();
  return rec;
}

async function begin({ client, provider, flow }) {
  const m = manifests.get(`${client}/${provider}`);
  if (!m) throw new Error('unknown client/provider');
  const bindingId = crypto.randomUUID();
  const b = { bindingId, manifest: m, flow: flow || m.loginFlow, status: 'binding', at: Date.now() };
  bindings.set(bindingId, b);
  if (b.flow === 'offline') return { bindingId, flow: b.flow, fields: m.fields, next: 'complete' };
  if (b.flow === 'cookie') return { bindingId, flow: b.flow, fields: m.fields, next: 'complete' };
  if (m.provider === 'bilibili' && b.flow === 'qrcode') {
    const qr = await bilibili.begin();
    b.qrcodeKey = qr.qrcodeKey;
    return { bindingId, flow: b.flow, ...qr };
  }
  if (m.provider === 'mockqr' && b.flow === 'qrcode') {
    const qr = await mockqr.begin();
    b.qrcodeKey = qr.qrcodeKey;
    return { bindingId, flow: b.flow, ...qr };
  }
  return { bindingId, flow: b.flow, next: 'provider_required', message: `${m.provider} 登录流程由 provider 插件实现` };
}

async function complete({ bindingId, fields = {}, displayName }) {
  const b = bindings.get(bindingId);
  if (!b) throw new Error('binding not found');
  const m = b.manifest;
  for (const f of m.fields || []) {
    if (f.required && !fields[f.key]) throw new Error('missing field: ' + f.key);
  }

  let providerResult = null;
  if (m.client === 'llm' && m.provider === 'deepseek') {
    // 真实校验 + 写受保护配置；失败则不允许绑定
    const result = await deepseek.validate(fields);
    if (!result.ok) throw new Error(result.error || 'credential validation failed');
    providerResult = deepseek.writeConfig(fields);
  }

  const identityId = m.secretRef;
  // 敏感字段（cookie/token/password）不进 records、不进日志；真实实现应进加密凭证库
  const safeFields = {};
  for (const f of m.fields || []) {
    if (f.type === 'secret') safeFields[f.key] = fields[f.key] ? '已提供（不回显）' : undefined;
    else safeFields[f.key] = fields[f.key];
  }
  const rec = {
    identityId,
    client: m.client,
    provider: m.provider,
    displayName: displayName || fields.username || fields.uin || m.displayName,
    scopes: m.scopes,
    secretRef: m.secretRef,
    status: 'bound',
    metadata: { ...safeFields, boundAt: Date.now() },
  };
  // 敏感字段只进元数据存储，不回显、不进日志（真实实现应进加密凭证库）
  upsert(rec);
  bindings.delete(bindingId);
  return rec;
}

function issue({ identityId, scopes = [], ttlSec = 900 }) {
  const rec = records.find((r) => r.identityId === identityId && r.status === 'bound');
  if (!rec) throw new Error('identity not bound');
  for (const s of scopes) if (!rec.scopes.includes(s)) throw new Error('scope denied: ' + s);
  const token = crypto.randomBytes(24).toString('hex');
  const grant = { token, identityId, scopes, expiresAt: Date.now() + ttlSec * 1000 };
  tokens.set(token, grant);
  return { token, identityId, scopes, expiresAt: grant.expiresAt };
}

function revoke({ identityId }) {
  const rec = records.find((r) => r.identityId === identityId);
  if (!rec) throw new Error('identity not found');
  rec.status = 'revoked';
  upsert(rec);
  return { identityId, status: rec.status };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  const url = new URL(req.url, 'http://127.0.0.1');
  const read = () => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

  try {
    if (url.pathname === '/identity/manifests') {
      res.end(JSON.stringify([...manifests.values()], null, 2)); return;
    }
    if (url.pathname === '/identity/list') {
      res.end(JSON.stringify(records.map((r) => ({ ...r, metadata: { ...r.metadata, sessdata: undefined } })), null, 2)); return;
    }
    if (url.pathname === '/identity/begin' && req.method === 'POST') {
      res.end(JSON.stringify(await begin(await read()))); return;
    }
    if (url.pathname === '/identity/complete' && req.method === 'POST') {
      res.end(JSON.stringify(await complete(await read()))); return;
    }
    if (url.pathname === '/identity/poll' && req.method === 'POST') {
      const p = await read();
      const b = bindings.get(p.bindingId);
      if (!b) { res.writeHead(400); res.end(JSON.stringify({ error: 'binding not found' })); return; }
      if (b.manifest.provider === 'bilibili') {
        const r = await bilibili.poll(p.qrcodeKey || b.qrcodeKey);
        if (r.status === 'bound') {
          bilibili.writeConfig(r);
          const rec = await complete({ bindingId: p.bindingId, fields: { sessdata: r.sessdata }, displayName: r.displayName });
          res.end(JSON.stringify({ ...r, record: rec }));
        } else {
          res.end(JSON.stringify(r));
        }
        return;
      }
      if (b.manifest.provider === 'mockqr') {
        const r = await mockqr.poll(p.qrcodeKey || b.qrcodeKey);
        if (r.status === 'bound') {
          const rec = await complete({ bindingId: p.bindingId, fields: {}, displayName: r.displayName });
          res.end(JSON.stringify({ ...r, record: rec }));
        } else {
          res.end(JSON.stringify(r));
        }
        return;
      }
      res.writeHead(400); res.end(JSON.stringify({ error: 'unsupported provider' })); return;
    }
    if (url.pathname === '/identity/issue' && req.method === 'POST') {
      res.end(JSON.stringify(issue(await read()))); return;
    }
    if (url.pathname === '/identity/revoke' && req.method === 'POST') {
      res.end(JSON.stringify(revoke(await read()))); return;
    }
    if (url.pathname === '/identity/test' && req.method === 'POST') {
      const { identityId } = await read();
      const rec = records.find((r) => r.identityId === identityId && r.status === 'bound');
      res.end(JSON.stringify({ ok: !!rec, identityId })); return;
    }
    if (url.pathname === '/shutdown' && req.method === 'POST') {
      res.end('{}'); server.close(() => process.exit(0)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[identity] 127.0.0.1:${PORT}`));
