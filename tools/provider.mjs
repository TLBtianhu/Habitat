// WorkerProvider：**全项目唯一**知道"Worker 放在哪"的地方。
// 其它模块只调 ensure/restart/status，不关心它是 WSL、Docker 还是别的机器。
//
// 用法：
//   node provider.mjs status
//   node provider.mjs wake
//   node provider.mjs ensure
//   node provider.mjs restart body|world
import { execFileSync } from 'node:child_process';

const DISTRO = process.env.FB_WSL_DISTRO || 'Ubuntu';
const USER = process.env.FB_WSL_USER || 'tlb3';
const BRIDGE = 'http://127.0.0.1:9225';

function wsl(args, { user = 'root', timeout = 60000 } = {}) {
  const cmd = ['-d', DISTRO, ...(user ? ['-u', user] : []), '--', ...args];
  try {
    const out = execFileSync('wsl.exe', cmd, { encoding: 'utf8', timeout });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, err: (e.stderr || e.message || '').toString().trim(), code: e.status };
  }
}

async function bridgeStatus() {
  try {
    const r = await fetch(BRIDGE + '/status', { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function wake() {
  const r = wsl(['true'], { user: USER, timeout: 30000 });
  console.log('[provider] wake', r.ok ? 'ok' : 'failed: ' + r.err);
  return r.ok;
}

async function ensure() {
  const r = wsl(['systemctl', 'start', 'fishbowl-body.service', 'fishbowl-world.service']);
  console.log('[provider] ensure', r.ok ? 'ok' : 'failed: ' + r.err);
  for (let i = 0; i < 20; i++) {
    const s = await bridgeStatus();
    if (s && s.body) {
      console.log('[provider] body connected');
      return true;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  console.log('[provider] body not connected yet');
  return false;
}

function restart(which = 'body') {
  const unit = which === 'world' ? 'fishbowl-world.service' : 'fishbowl-body.service';
  const r = wsl(['systemctl', 'restart', unit]);
  console.log('[provider] restart', unit, r.ok ? 'ok' : 'failed: ' + r.err);
}

async function status() {
  const units = wsl(['systemctl', 'is-active', 'fishbowl-body.service', 'fishbowl-world.service']);
  console.log('[provider] units:', units.ok ? units.out.replace(/\n/g, ' | ') : units.err);
  const s = await bridgeStatus();
  if (!s) {
    console.log('[provider] bridge: down');
    return;
  }
  console.log('[provider] bridge: body=' + s.body + ' bot=' + s.bot +
    ' obsAge=' + s.obsAgeMs + ' capsViolations=' + JSON.stringify(s.capsViolations));
  if (s.caps) console.log('[provider] caps:', JSON.stringify(s.caps));
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'wake': await wake(); break;
  case 'ensure': await ensure(); break;
  case 'restart': restart(arg); break;
  case 'status': await status(); break;
  default:
    console.log('usage: node provider.mjs status|wake|ensure|restart <body|world>');
}
