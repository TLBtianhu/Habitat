// Habitat 独立用户实例：不依赖系统 systemd，使用当前 WSL 用户管理自己的子进程。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const command = args[0] || 'status';
const rootIndex = args.indexOf('--root');
const ROOT = path.posix.resolve(rootIndex >= 0 ? args[rootIndex + 1] || '' : process.env.HABITAT_INSTANCE_ROOT || '');
if (!/^\/home\/[^/]+\/\.local\/share\/habitat(?:-[^/]+)?$/.test(ROOT)) throw new Error('独立实例必须位于当前用户的 .local/share/habitat 目录');
const APP = path.join(ROOT, 'app');
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(ROOT, 'config');
const RUNTIME = path.join(ROOT, 'runtime');
const PID_FILE = path.join(DATA, 'supervisor.pid.json');
const STATUS_FILE = path.join(DATA, 'instance-status.json');
const INSTANCE_CONFIG = path.join(CONFIG, 'instance.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
};
const alive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const cmdline = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '); } catch { return ''; } };
const ownedPid = (pid, marker = SCRIPT) => alive(pid) && cmdline(pid).includes(marker) && cmdline(pid).includes(ROOT);

function ensureLayout() {
  for (const dir of [DATA, CONFIG, path.join(DATA, 'logs'), path.join(DATA, 'pump'), path.join(DATA, 'outbox'),
    path.join(DATA, 'episodes'), path.join(DATA, 'memory'), path.join(DATA, 'plugins'), path.join(DATA, 'outlets'),
    path.join(DATA, 'adapters'), path.join(DATA, 'artifacts'), path.join(DATA, 'hls'), path.join(DATA, 'cache', 'tts'), path.join(DATA, 'models')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  for (const name of ['owner.token', 'agent.token', 'napcat.token', 'mcpfabric.token']) {
    const file = path.join(CONFIG, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
  }
  if (!fs.existsSync(INSTANCE_CONFIG)) writeJson(INSTANCE_CONFIG, {
    schemaVersion: 1,
    publicStreaming: false,
    agent: true,
    applications: { qq: false, bilibili: false, mc: false },
  });
}

function instanceConfig() {
  const value = readJson(INSTANCE_CONFIG, {});
  const ports = {
    control: 10240, desktop: 10260, voice: 10270, audio: 10271, outlet: 10272, stage: 10230,
    ...(value.ports || {}),
  };
  for (const [name, port] of Object.entries(ports)) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error(`invalid instance port: ${name}`);
  }
  if (new Set(Object.values(ports)).size !== Object.values(ports).length) throw new Error('instance ports must be unique');
  return { value, ports };
}

function environment(ports, config) {
  const enabled = (name) => config.applications?.[name] === true;
  const env = {
    ...process.env,
    HABITAT_INSTANCE_ROOT: ROOT,
    HABITAT_APP_ROOT: APP,
    HABITAT_DATA_ROOT: DATA,
    HABITAT_CONFIG_ROOT: CONFIG,
    HABITAT_RUNTIME_ROOT: RUNTIME,
    HABITAT_NODE: path.join(RUNTIME, 'node22/bin/node'),
    HABITAT_CONTROL_PORT: String(ports.control),
    HABITAT_DESKTOP_PORT: String(ports.desktop),
    HABITAT_VOICE_PORT: String(ports.voice),
    HABITAT_AUDIO_PORT: String(ports.audio),
    HABITAT_OUTLET_PORT: String(ports.outlet),
    HABITAT_STAGE_PORT: String(ports.stage),
    HABITAT_CONTROL_URL: `http://127.0.0.1:${ports.control}`,
    HABITAT_DESKTOP_URL: `http://127.0.0.1:${ports.desktop}`,
    HABITAT_VOICE_URL: `http://127.0.0.1:${ports.voice}`,
    HABITAT_AUDIO_URL: `http://127.0.0.1:${ports.audio}`,
    HABITAT_OUTLET_URL: `http://127.0.0.1:${ports.outlet}`,
    HABITAT_STAGE: `http://127.0.0.1:${ports.stage}`,
    HABITAT_VOICE: `http://127.0.0.1:${ports.voice}`,
    HABITAT_OWNER_TOKEN_FILE: path.join(CONFIG, 'owner.token'),
    HABITAT_AGENT_TOKEN_FILE: path.join(CONFIG, 'agent.token'),
    HABITAT_NAPCAT_TOKEN_FILE: path.join(CONFIG, 'napcat.token'),
    MCPFABRIC_TOKEN_FILE: path.join(CONFIG, 'mcpfabric.token'),
    HABITAT_LLM_CONFIG: path.join(CONFIG, 'llm.json'),
    HABITAT_RESIDENCE_POLICY: path.join(CONFIG, 'residence-policy.json'),
    HABITAT_VOICE_POLICY: path.join(CONFIG, 'voice.json'),
    HABITAT_BILIBILI_COOKIE_FILE: path.join(CONFIG, 'bilibili-cookies.txt'),
    HABITAT_BILIBILI_CONFIG: path.join(CONFIG, 'bilibili.json'),
    HABITAT_BILIBILI_LIVE_CONFIG: path.join(CONFIG, 'bilibili-live.json'),
    HABITAT_EPISODE_ID: 'installed-current',
    HABITAT_EPISODE_DIR: path.join(DATA, 'episodes'),
    HABITAT_MEMORY_DIR: path.join(DATA, 'memory'),
    HABITAT_OUTBOX: path.join(DATA, 'outbox', 'agent.json'),
    HABITAT_CONTROL_OUTBOX: path.join(DATA, 'outbox', 'control-tasks.json'),
    HABITAT_SYSTEM_CHAT_PUMP: path.join(DATA, 'pump', 'system-chat.json'),
    HABITAT_SYSTEM_CHAT_WATERMARK: path.join(DATA, 'agent-system-chat.json'),
    HABITAT_ONEBOT_STATUS_FILE: path.join(DATA, 'pump', 'onebot-status.json'),
    HABITAT_PRESENCE_FILE: path.join(DATA, 'pump', 'presence.json'),
    HABITAT_CHAT_LOG: path.join(DATA, 'system-chat.jsonl'),
    HABITAT_TASKS_FILE: path.join(DATA, 'control-tasks.json'),
    HABITAT_AFTER_ACTION_FILE: path.join(DATA, 'after-action.jsonl'),
    HABITAT_SKILL_LIBRARY: path.join(DATA, 'skill-library.json'),
    HABITAT_LIFECYCLE_FILE: path.join(DATA, 'lifecycle.json'),
    HABITAT_SESSION_PATH: path.join(DATA, 'app-sessions.json'),
    HABITAT_PLUGIN_CACHE: path.join(DATA, 'plugins'),
    HABITAT_UTTERANCE_LOG: path.join(DATA, 'utterances.jsonl'),
    HABITAT_TTS_CACHE: path.join(DATA, 'cache', 'tts'),
    HABITAT_MODELS_DIR: path.join(DATA, 'models'),
    HABITAT_OUTLET_STATE_DIR: path.join(DATA, 'outlets'),
    HABITAT_OUTLET_LOG_DIR: path.join(DATA, 'logs', 'outlets'),
    HABITAT_ADAPTER_STATE_DIR: path.join(DATA, 'adapters'),
    HABITAT_PIPELINE_STATUS: path.join(DATA, 'artifacts', 'pipeline.json'),
    HABITAT_HLS_PLAYLIST: path.join(DATA, 'hls', 'live.m3u8'),
    FB_STAGE_ROOT: path.join(APP, 'stage'),
    FB_HLS_ROOT: path.join(DATA, 'hls'),
    FB_MC_FRAME: path.join(DATA, 'artifacts', 'mc-pixels.jpg'),
    HABITAT_QQ_ENABLED: enabled('qq') ? '1' : '0',
    HABITAT_BILIBILI_ENABLED: enabled('bilibili') ? '1' : '0',
    HABITAT_MC_ENABLED: enabled('mc') ? '1' : '0',
    PATH: `${path.join(RUNTIME, 'node22/bin')}:${process.env.PATH || '/usr/bin:/bin'}`,
    LD_LIBRARY_PATH: [path.join(RUNTIME, 'chrome-libs'), path.join(RUNTIME, 'chrome', 'chrome-headless-shell-linux64'), process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':'),
  };
  return env;
}

const children = new Map();
let currentStatus = null;
let currentPorts = null;
let stopping = false;

function persistStatus(state = null) {
  if (!currentStatus) return;
  currentStatus = {
    ...currentStatus,
    state: state || currentStatus.state,
    supervisorPid: process.pid,
    updatedAt: Date.now(),
    services: Object.fromEntries([...children.entries()].map(([id, entry]) => [id, {
      pid: entry.child.pid,
      state: entry.state,
      exitCode: entry.exitCode,
      required: entry.required,
      lastError: entry.lastError,
    }])),
  };
  writeJson(STATUS_FILE, currentStatus);
}

function spawnService(id, script, { required = true, env }) {
  const log = fs.createWriteStream(path.join(DATA, 'logs', `${id}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [path.join(APP, script)], {
    cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry = { child, state: 'running', exitCode: null, required, lastError: null };
  children.set(id, entry);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('error', (error) => { entry.lastError = error.message; entry.state = 'failed'; persistStatus(); });
  child.once('exit', (code, signal) => {
    entry.exitCode = code;
    entry.state = stopping ? 'stopped' : (code === 0 ? 'stopped' : 'failed');
    entry.lastError = stopping || code === 0 ? null : `exit ${code ?? signal}`;
    log.end();
    persistStatus();
  });
  persistStatus();
}

async function runSupervisor() {
  const { value: config, ports } = instanceConfig();
  currentPorts = ports;
  currentStatus = { schemaVersion: 1, state: 'starting', root: ROOT, ports, configurationRequired: [], startedAt: Date.now() };
  writeJson(PID_FILE, { pid: process.pid, root: ROOT, script: SCRIPT, startedAt: Date.now() });
  const env = environment(ports, config);
  if (config.agent !== false && !fs.existsSync(path.join(CONFIG, 'llm.json'))) currentStatus.configurationRequired.push('llm');
  persistStatus();
  const services = [
    ['stage', 'tools/stage-server.mjs', true],
    ['control', 'control/server.mjs', true],
    ['desktop', 'desktop/compositor-service.mjs', true],
    ['voice', 'voice/server.mjs', true],
    ['audio', 'audio/mixer-service.mjs', true],
    ['outlet', 'control/outlet-supervisor.mjs', true],
  ];
  for (const [id, script, required] of services) spawnService(id, script, { required, env });
  if (config.agent !== false && fs.existsSync(path.join(CONFIG, 'llm.json'))) spawnService('agent', 'agent/run-continuous.mjs', { required: false, env });
  currentStatus.state = 'running';
  persistStatus();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    currentStatus.state = 'stopping';
    persistStatus();
    for (const [id, entry] of [...children.entries()].reverse()) {
      if (!alive(entry.child.pid)) continue;
      entry.state = 'stopping';
      persistStatus();
      try { entry.child.kill('SIGTERM'); } catch {}
      const deadline = Date.now() + 6000;
      while (alive(entry.child.pid) && Date.now() < deadline) await sleep(100);
      if (alive(entry.child.pid)) {
        try { entry.child.kill('SIGKILL'); } catch {}
        entry.lastError = 'forced_after_timeout';
      }
      entry.state = 'stopped';
      persistStatus();
    }
    currentStatus.state = 'stopped';
    persistStatus();
    try { fs.rmSync(PID_FILE, { force: true }); } catch {}
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  setInterval(() => persistStatus(), 5000).unref();
}

async function waitHealth(ports, timeoutMs = 30000) {
  const checks = [
    `http://127.0.0.1:${ports.stage}/live/status`,
    `http://127.0.0.1:${ports.control}/status`,
    `http://127.0.0.1:${ports.desktop}/status`,
    `http://127.0.0.1:${ports.voice}/health`,
    `http://127.0.0.1:${ports.audio}/health`,
    `http://127.0.0.1:${ports.outlet}/health`,
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(checks.map(async (url) => {
      try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok; } catch { return false; }
    }));
    if (results.every(Boolean)) return;
    await sleep(300);
  }
  throw new Error('instance health check timed out');
}

async function stopOwnedChildren(status) {
  for (const entry of Object.values(status?.services || {}).reverse()) {
    const pid = entry.pid;
    if (!ownedPid(pid, APP)) continue;
    try { process.kill(pid, 'SIGTERM'); } catch {}
    const deadline = Date.now() + 6000;
    while (alive(pid) && Date.now() < deadline) await sleep(100);
    if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}

async function startInstance() {
  ensureLayout();
  const previous = readJson(PID_FILE);
  if (previous && ownedPid(previous.pid)) {
    const status = readJson(STATUS_FILE, {});
    console.log(JSON.stringify({ state: 'already_running', pid: previous.pid, configurationRequired: status.configurationRequired || [] }));
    return;
  }
  const oldStatus = readJson(STATUS_FILE);
  const orphans = Object.values(oldStatus?.services || {}).some((entry) => ownedPid(entry.pid, APP));
  if (orphans) throw new Error('recovery_required: supervisor is stopped but instance children remain; run stop first');
  fs.rmSync(PID_FILE, { force: true });
  const { ports } = instanceConfig();
  const log = fs.openSync(path.join(DATA, 'logs', 'supervisor.log'), 'a');
  const child = spawn(process.execPath, [SCRIPT, 'run', '--root', ROOT], {
    cwd: APP, env: { ...process.env, HABITAT_INSTANCE_ROOT: ROOT }, detached: true, stdio: ['ignore', log, log],
  });
  child.unref();
  fs.closeSync(log);
  try {
    await waitHealth(ports);
  } catch (error) {
    const launched = readJson(PID_FILE);
    if (launched && ownedPid(launched.pid)) {
      try { process.kill(launched.pid, 'SIGTERM'); } catch {}
      await sleep(1000);
    }
    throw error;
  }
  const status = readJson(STATUS_FILE, {});
  console.log(JSON.stringify({ state: 'running', pid: child.pid, ports, configurationRequired: status.configurationRequired || [] }));
}

async function stopInstance() {
  const pid = readJson(PID_FILE)?.pid;
  if (pid && ownedPid(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    const deadline = Date.now() + 45000;
    while (ownedPid(pid) && Date.now() < deadline) await sleep(150);
    if (ownedPid(pid)) throw new Error('instance stop timed out');
  } else {
    await stopOwnedChildren(readJson(STATUS_FILE));
  }
  fs.rmSync(PID_FILE, { force: true });
  const status = readJson(STATUS_FILE, {});
  status.state = 'stopped';
  status.updatedAt = Date.now();
  writeJson(STATUS_FILE, status);
  console.log(JSON.stringify({ state: 'stopped' }));
}

function statusInstance() {
  const status = readJson(STATUS_FILE, { state: 'stopped', services: {}, configurationRequired: [] });
  const pid = readJson(PID_FILE)?.pid;
  const running = ownedPid(pid);
  const orphans = Object.values(status.services || {}).some((entry) => ownedPid(entry.pid, APP));
  console.log(JSON.stringify({
    state: running ? status.state : (orphans ? 'recovery_required' : 'stopped'),
    pid: running ? pid : null,
    supervisorRunning: running,
    root: ROOT,
    ports: status.ports || currentPorts,
    configurationRequired: status.configurationRequired || [],
    services: status.services || {},
    updatedAt: status.updatedAt || null,
  }));
}

if (command === 'run') await runSupervisor();
else if (command === 'start') await startInstance();
else if (command === 'stop') await stopInstance();
else if (command === 'status') statusInstance();
else throw new Error('usage: instance-supervisor.mjs start|stop|status|run --root <instance-root>');
