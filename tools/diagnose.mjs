// 诊断式安装验收：只读取当前认证控制面，不依赖旧无鉴权桥。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';

const out = { at: new Date().toISOString(), checks: {} };
const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(5000) })).json();
const exists = (p) => fs.existsSync(p);

function wsl(cmd) {
  try { return execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', cmd], { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch { return ''; }
}

out.checks.services = wsl("systemctl is-active habitat-stage habitat-control habitat-desktop habitat-agent habitat-voice habitat-audio habitat-outlet-supervisor | paste -sd' ' -");
out.checks.control = await get('http://127.0.0.1:9240/status').catch((e) => ({ error: e.message }));
out.checks.pump = await get('http://127.0.0.1:9240/pump/status').catch((e) => ({ error: e.message }));
out.checks.desktop = await get('http://127.0.0.1:9260/status').catch((e) => ({ error: e.message }));
out.checks.voice = await get('http://127.0.0.1:9270/status').catch((e) => ({ error: e.message }));
out.checks.outlets = await get('http://127.0.0.1:9272/status').catch((e) => ({ error: e.message }));
out.checks.hls = await get('http://127.0.0.1:9230/live/status').catch((e) => ({ error: e.message }));
out.checks.paths = {
  app: exists('/opt/habitat/app') || wsl('test -d /opt/habitat/app && echo yes || echo no'),
  data: exists('/var/lib/habitat') || wsl('test -d /var/lib/habitat && echo yes || echo no'),
  config: exists('/etc/habitat') || wsl('test -d /etc/habitat && echo yes || echo no'),
  llm: exists('/etc/habitat/llm.json') || wsl('test -f /etc/habitat/llm.json && echo yes || echo no'),
};
out.checks.mcpfabric = await fetch('http://127.0.0.1:25600/rpc', {
  method: 'POST',
  headers: { authorization: `Bearer ${loadMcpfabricToken()}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.info', params: {} }),
}).then((r) => r.json()).catch((e) => ({ error: e.message }));

fs.mkdirSync('C:/Habitat/stage', { recursive: true });
fs.writeFileSync('C:/Habitat/stage/diagnostics.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
