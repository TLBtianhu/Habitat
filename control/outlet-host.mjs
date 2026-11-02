// Outlet Host：只向 Supervisor 提交命令；不再直接持有或根据 PID 杀进程。
import fs from 'node:fs';

const SUPERVISOR = process.env.HABITAT_OUTLET_URL || 'http://127.0.0.1:9272';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const token = process.env.HABITAT_OUTLET_TOKEN || (() => {
  const file = isRoot ? '/etc/habitat/owner.token' : '/etc/habitat/agent.token';
  return fs.readFileSync(file, 'utf8').trim();
})();

async function call(path, body = null) {
  const r = await fetch(SUPERVISOR + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body ? 12000 : 5000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `outlet supervisor HTTP ${r.status}`);
  return data;
}

export function start(name = 'hls') {
  return call('/outlets/start', { name });
}
export function stop(name = 'hls') {
  return call('/outlets/stop', { name });
}
export function status() {
  return call('/status');
}

const [cmd, name] = process.argv.slice(2);
if (cmd === 'start') console.log(await start(name));
if (cmd === 'stop') console.log(await stop(name));
if (cmd === 'status') console.log(JSON.stringify(await status(), null, 2));
