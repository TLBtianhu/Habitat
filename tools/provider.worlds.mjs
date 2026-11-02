// World Provider：她是"连世界的客户端"，不是世界的主人。
// 用法：
//   node provider.worlds.mjs list
//   node provider.worlds.mjs connect home
//   node provider.worlds.mjs leave
//   node provider.worlds.mjs status
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = 'C:/Habitat';
const REGISTRY = path.join(ROOT, 'worlds.json');
const SESSION = process.env.FB_WORLD_SESSION || '\\\\wsl$\\Ubuntu\\var\\lib\\habitat\\artifacts\\world-session.json';

const BOT_MIN = '1.8.8';
const BOT_MAX = '26.1';

function loadWorlds() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).worlds || [];
}

function parseAddr(addr) {
  const i = addr.lastIndexOf(':');
  return i < 0 ? { host: addr, port: 25565 } : { host: addr.slice(0, i), port: Number(addr.slice(i + 1)) };
}

function reachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

function readSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, 'utf8')); } catch { return null; }
}

function writeSession(obj) {
  fs.mkdirSync(path.dirname(SESSION), { recursive: true });
  fs.writeFileSync(SESSION, JSON.stringify(obj, null, 2));
}

async function list() {
  const worlds = loadWorlds();
  for (const w of worlds) {
    const { host, port } = parseAddr(w.address);
    const up = await reachable(host, port);
    console.log(
      `${w.id.padEnd(12)} ${String(w.kind).padEnd(7)} ${w.address.padEnd(24)} ` +
      `policy=${String(w.policy || 'owner').padEnd(6)} ${up ? 'UP  ' : 'DOWN'}  ${w.note || ''}`
    );
  }
}

function parseVer(v) {
  return String(v).split('.').map((x) => parseInt(x, 10) || 0);
}

function cmpVer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  for (let i = 0; i < 3; i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function versionOk(v) {
  if (!v) return true;
  return cmpVer(v, BOT_MIN) >= 0 && cmpVer(v, BOT_MAX) <= 0;
}

async function connect(id) {
  const w = loadWorlds().find((x) => x.id === id);
  if (!w) { console.error('unknown world:', id); process.exit(1); }
  if (!versionOk(w.version)) { console.error('version unsupported by bot:', w.version); process.exit(1); }
  const { host, port } = parseAddr(w.address);
  const up = await reachable(host, port);
  if (!up) {
    console.error(`refusing to connect: ${w.address} unreachable`);
    writeSession({ worldId: null, denied: id, reason: 'unreachable', at: Date.now() });
    process.exit(2);
  }
  const session = {
    worldId: w.id,
    address: w.address,
    host,
    port,
    version: w.version || '1.21.4',
    auth: w.auth || 'offline',
    policy: w.policy || 'owner',
    at: Date.now(),
  };
  writeSession(session);
  console.log('session ->', JSON.stringify(session));
}

function leave() {
  writeSession({ worldId: null, at: Date.now() });
  console.log('left world');
}

async function status() {
  const s = readSession();
  if (!s || !s.worldId) {
    console.log('world: none（纯聊天/写代码状态）', s && s.denied ? `last denied=${s.denied} (${s.reason})` : '');
    return;
  }
  const up = await reachable(s.host, s.port);
  console.log(`world: ${s.worldId} @ ${s.address} v${s.version} policy=${s.policy} ${up ? 'UP' : 'DOWN'}`);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'list': await list(); break;
  case 'connect': await connect(arg); break;
  case 'leave': leave(); break;
  case 'status': await status(); break;
  default: console.log('usage: node provider.worlds.mjs list|connect <id>|leave|status');
}
