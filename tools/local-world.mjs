// 本地世界（WSL 原生）：只调 WSL 里的脚本，不依赖宿主 JDK。
//   node local-world.mjs start|stop|status
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const SCRIPT = process.env.FB_WSL_WORLD_SCRIPT || '/opt/habitat/src/tools/wsl-local-world.sh';

function wsl(args) {
  try {
    const out = execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', SCRIPT, ...args], { encoding: 'utf8', timeout: 120000 });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || e.message || '') };
  }
}

function portOpen(port = 25565, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(1200);
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

const cmd = process.argv[2];
if (cmd === 'status') {
  console.log('local world:', (await portOpen()) ? 'UP' : 'DOWN', '· native WSL JDK');
} else if (cmd === 'start' || cmd === 'stop') {
  const r = wsl([cmd]);
  console.log(r.out.trim());
  if (!r.ok) process.exitCode = 1;
} else {
  console.log('usage: node local-world.mjs start|stop|status');
}
