// Adapter Host：按 manifest 启停独立进程，Core 不需要跟着重启
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadAdapters } from '../adapters/registry.mjs';

const procs = new Map();
const adapters = loadAdapters();
const pidDir = process.env.HABITAT_ADAPTER_STATE_DIR || '/var/lib/habitat/adapters';
fs.mkdirSync(pidDir, { recursive: true });
const pidFile = (name) => `${pidDir}/${name}.pid`;

export function start(name) {
  const m = adapters[name];
  if (!m) throw new Error('unknown adapter: ' + name);
  if (procs.has(name)) return { already: true };
  const p = spawn(process.execPath, [m.entry], { cwd: m.dir, stdio: 'ignore', detached: true, env: { ...process.env, HABITAT_ADAPTER_NAME: name } });
  p.unref();
  fs.writeFileSync(pidFile(name), String(p.pid));
  procs.set(name, p);
  p.on('exit', () => { procs.delete(name); try { fs.unlinkSync(pidFile(name)); } catch {} });
  return { started: true, name, version: m.version, pid: p.pid };
}

export function stop(name) {
  let pid = procs.get(name)?.pid;
  if (!pid && fs.existsSync(pidFile(name))) pid = Number(fs.readFileSync(pidFile(name), 'utf8'));
  if (!pid) return { alreadyStopped: true };
  try { process.kill(pid); } catch {}
  procs.delete(name);
  try { fs.unlinkSync(pidFile(name)); } catch {}
  return { stopped: true, name, pid };
}

export function status() {
  return Object.fromEntries(Object.entries(adapters).map(([name, m]) => [name, { version: m.version, running: procs.has(name) || fs.existsSync(pidFile(name)) }]));
}

const [cmd, name] = process.argv.slice(2);
if (cmd === 'start') console.log(start(name));
if (cmd === 'stop') console.log(stop(name));
if (cmd === 'status') console.log(JSON.stringify(status(), null, 2));
