// mc-launcher：同级应用，负责世界与 AI 客户端的 provisioning 和生命周期，不负责游戏内聊天。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { NativeMcClient } from '../../clients/mc-native.mjs';

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
const javaProcess = (pid) => /(?:\/bin\/java|java\.exe)(?:\s|$)/.test(cmdline(pid));
const owned = (pid, marker) => alive(pid) && javaProcess(pid) && cmdline(pid).includes(marker);
const ownedPids = (marker, execFileImpl = execFileSync) => {
  try {
    return execFileImpl('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, COLUMNS: '200', LINES: '50' } })
      .split(/\r?\n/)
      .filter((line) => line.includes(marker))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isSafeInteger(pid) && owned(pid, marker));
  } catch { return []; }
};
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function download(url, dest, expectedSha, fetchImpl) {
  const parsed = new URL(url);
  const allowed = new Set(['api.adoptium.net', 'github.com', 'bmclapi2.bangbang93.com', 'www.modelscope.cn', 'hf-mirror.com', 'huggingface.co']);
  if (parsed.protocol !== 'https:' || !allowed.has(parsed.host)) throw new Error('download host not allowed');
  const response = await fetchImpl(parsed.href, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 512 * 1024 * 1024) throw new Error('download too large');
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  if (expectedSha && hashFile(tmp) !== expectedSha.toLowerCase()) throw new Error('download hash mismatch');
  fs.renameSync(tmp, dest);
}

function safeExtract(archive, dest, execFileImpl) {
  const entries = execFileImpl('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('unsafe archive path');
  }
  const links = execFileImpl('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/);
  for (const line of links) {
    if (!/^[lh]/.test(line)) continue;
    const [left, target] = line.split(/\s(?:->|link to)\s/);
    if (!target) throw new Error('invalid archive link');
    const source = left.trim().split(/\s+/).pop();
    if (path.posix.isAbsolute(target)) throw new Error('absolute archive link');
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), target));
    if (resolved === '..' || resolved.startsWith('../')) throw new Error('archive link escapes root');
  }
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  execFileImpl('tar', ['-xzf', archive, '-C', dest]);
}

function portOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

export function createRuntime({
  env = process.env,
  episode = null,
  episodeStore = null,
  spawnImpl = spawn,
  fetchImpl = fetch,
  execFileImpl = execFileSync,
  clientFactory = null,
  portProbe = portOpen,
  ownedImpl = owned,
  killImpl = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const root = env.HABITAT_INSTANCE_ROOT;
  if (!root) throw new Error('mc-launcher requires an installed instance root');
  const topology = env.HABITAT_MC_TOPOLOGY || 'local-wsl';
  const autoStart = env.HABITAT_MC_LAUNCHER_AUTO_START === '1';
  const worldDir = env.HABITAT_MC_WORLD_DIR || path.join(root, 'data', 'world-server');
  const clientHome = env.HABITAT_MC_CLIENT_HOME || path.join(root, 'data', 'mc-client');
  const runtimeRoot = env.HABITAT_RUNTIME_ROOT || path.join(root, 'runtime');
  const sharedClientRoot = env.HABITAT_MC_SHARED_RUNTIME_DIR || path.join(runtimeRoot, 'mc-client');
  if (path.resolve(sharedClientRoot) === path.resolve(clientHome)) throw new Error('shared MC runtime must be separate from clientHome');
  const serverAddress = env.HABITAT_MC_SERVER_ADDRESS || '127.0.0.1:25565';
  const rpcUrl = env.HABITAT_MCPFABRIC_RPC || 'http://127.0.0.1:25600/rpc';
  const worldState = path.join(worldDir, 'launcher-world.json');
  const clientState = path.join(clientHome, 'launcher-client.json');
  const tokenFile = env.MCPFABRIC_TOKEN_FILE || path.join(root, 'config', 'mcpfabric.token');
  const token = () => String(env.MCPFABRIC_TOKEN || fs.readFileSync(tokenFile, 'utf8').trim());
  const serverAddressParts = serverAddress.match(/^(.*):(\d+)$/);
  if (!serverAddressParts) throw new Error('MC serverAddress must be host:port');
  const serverHost = serverAddressParts[1];
  const serverPort = Number(serverAddressParts[2]);
  const rpc = new URL(rpcUrl);
  let state = 'stopped';
  let phase = 'STOPPED';
  let lastError = null;
  let worldPid = null;
  let clientPid = null;
  const makeClient = () => clientFactory ? clientFactory() : new NativeMcClient({ rpc: rpcUrl, token: token() });

  function checkpoint(nextPhase, currentTask) {
    phase = nextPhase;
    if (!episode || !episodeStore) return;
    episode.addParticipant('mc-launcher.local');
    episode.addParticipant('mc.world.current');
    episode.checkpointState({ phase: nextPhase, currentTask, activeResidence: nextPhase === 'PROVISION' ? 'mc-launcher.local' : 'mc.world.current' });
    episodeStore.save(episode);
  }

  async function ensureJdk() {
    const configured = env.HABITAT_JAVA_HOME ? path.join(env.HABITAT_JAVA_HOME, 'bin', 'java') : '';
    if (configured && fs.existsSync(configured)) return env.HABITAT_JAVA_HOME;
    const jdkHome = path.join(runtimeRoot, 'jdk25');
    const java = path.join(jdkHome, 'bin', 'java');
    if (fs.existsSync(java)) return jdkHome;
    const metadataResponse = await fetchImpl('https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse', { signal: AbortSignal.timeout(30000) });
    if (!metadataResponse.ok) throw new Error('JDK metadata download failed');
    const metadata = await metadataResponse.json();
    const asset = metadata[0]?.binary?.package;
    if (!asset?.link || !asset?.checksum) throw new Error('JDK metadata incomplete');
    const archive = path.join(root, 'data', 'downloads', 'jdk25.tar.gz');
    await download(asset.link, archive, asset.checksum, fetchImpl);
    safeExtract(archive, jdkHome, execFileImpl);
    if (!fs.existsSync(java)) {
      const entries = fs.readdirSync(jdkHome);
      if (entries.length === 1) {
        const nested = path.join(jdkHome, entries[0]);
        for (const item of fs.readdirSync(nested)) fs.renameSync(path.join(nested, item), path.join(jdkHome, item));
        fs.rmdirSync(nested);
      }
    }
    execFileImpl(java, ['-version']);
    return jdkHome;
  }

  function linkDirectory(target, link) {
    if (!fs.existsSync(target)) throw new Error(`shared runtime directory missing: ${target}`);
    const current = fs.lstatSync(link, { throwIfNoEntry: false });
    if (current) {
      if (!current.isSymbolicLink() && !current.isJunction()) throw new Error(`legacy runtime directory requires explicit migration: ${link}`);
      if (path.resolve(fs.realpathSync(link)) !== path.resolve(target)) throw new Error(`runtime link points elsewhere: ${link}`);
      return;
    }
    fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }

  function linkRuntimeFile(rel) {
    const target = path.join(sharedClientRoot, rel);
    const link = path.join(clientHome, rel);
    if (!fs.existsSync(target)) throw new Error(`shared runtime file missing: ${rel}`);
    const current = fs.lstatSync(link, { throwIfNoEntry: false });
    if (current) {
      if (!current.isSymbolicLink()) {
        if (hashFile(link) === hashFile(target)) return;
        throw new Error(`legacy runtime file requires explicit migration: ${link}`);
      }
      if (path.resolve(fs.realpathSync(link)) !== path.resolve(target)) throw new Error(`runtime link points elsewhere: ${link}`);
      return;
    }
    fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') fs.copyFileSync(target, link);
    else fs.symlinkSync(target, link);
  }

  function activateClientRuntime(javaHome) {
    for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) {
      if (!fs.existsSync(path.join(sharedClientRoot, rel))) throw new Error(`mc-client runtime missing ${rel}`);
    }
    const activation = path.join(sharedClientRoot, 'activation.json');
    if (!fs.existsSync(activation)) {
      const output = execFileImpl(path.join(javaHome, 'bin', 'java'), ['-jar', path.join(sharedClientRoot, 'headlessmc.jar'), '--version'], { encoding: 'utf8', cwd: sharedClientRoot });
      if (output && !String(output).includes('3.0.0')) throw new Error('headlessmc version self-check failed');
      writeJson(activation, { schemaVersion: 1, bundle: 'habitat-mc-client-runtime', activatedAt: Date.now(), headlessmcSha256: hashFile(path.join(sharedClientRoot, 'headlessmc.jar')), mcpfabricSha256: hashFile(path.join(sharedClientRoot, 'mods', 'mcpfabric.jar')) });
    }
    for (const rel of ['versions', 'libraries', 'natives', 'assets']) fs.mkdirSync(path.join(sharedClientRoot, rel), { recursive: true, mode: 0o700 });
    for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) linkRuntimeFile(rel);
    for (const rel of ['versions', 'libraries', 'natives', 'assets']) linkDirectory(path.join(sharedClientRoot, rel), path.join(clientHome, rel));
  }

  async function ensureClientRuntime(javaHome) {
    if (!fs.existsSync(path.join(sharedClientRoot, 'headlessmc.jar')) || !fs.existsSync(path.join(sharedClientRoot, 'mods', 'mcpfabric.jar'))) {
      const template = env.HABITAT_MC_LAUNCHER_TEMPLATE;
      if (template) {
        for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) {
          const source = path.join(template, rel);
          if (!fs.existsSync(source)) throw new Error('template missing ' + rel);
          fs.mkdirSync(path.dirname(path.join(sharedClientRoot, rel)), { recursive: true, mode: 0o700 });
          fs.copyFileSync(source, path.join(sharedClientRoot, rel));
        }
        for (const rel of ['versions', 'libraries', 'natives', 'assets']) {
          const source = path.join(template, rel);
          if (fs.existsSync(source)) fs.cpSync(source, path.join(sharedClientRoot, rel), { recursive: true });
        }
      } else {
        const lock = readJson(new URL('../../runtime/mc-client-lock.json', import.meta.url), {});
        const url = env.HABITAT_MC_CLIENT_RUNTIME_URL || lock.source;
        const sha = env.HABITAT_MC_CLIENT_RUNTIME_SHA256 || lock.sha256;
        if (!url || !sha) throw new Error('mc-client runtime URL and SHA256 required');
        const archive = path.join(root, 'data', 'downloads', 'mc-client-runtime.tar.gz');
        await download(url, archive, sha, fetchImpl);
        safeExtract(archive, sharedClientRoot, execFileImpl);
      }
    }
    activateClientRuntime(javaHome);
  }

  async function ensureWorld() {
    fs.mkdirSync(worldDir, { recursive: true, mode: 0o700 });
    const jar = path.join(worldDir, 'server.jar');
    if (!fs.existsSync(jar)) {
      const url = env.HABITAT_MC_SERVER_JAR_URL || 'https://bmclapi2.bangbang93.com/version/1.21.4/server';
      const sha = env.HABITAT_MC_SERVER_JAR_SHA256;
      if (!sha) throw new Error('server.jar SHA256 required');
      await download(url, jar, sha, fetchImpl);
    }
    if (!fs.existsSync(path.join(worldDir, 'eula.txt'))) fs.writeFileSync(path.join(worldDir, 'eula.txt'), 'eula=true\n', { mode: 0o600 });
    const properties = path.join(worldDir, 'server.properties');
    const desired = new Map([
      ['online-mode', 'false'],
      ['motd', 'Habitat local world 1.21.4'],
      ['max-players', '8'],
      ['view-distance', '6'],
      ['simulation-distance', '4'],
      ['spawn-protection', '0'],
      ['difficulty', 'peaceful'],
      ['gamemode', 'survival'],
      ['level-name', 'world'],
      ['server-port', String(serverPort)],
      ['server-ip', '127.0.0.1'],
      ['enable-rcon', 'true'],
      ['rcon.port', String(serverPort + 10)],
      ['enable-command-block', 'false'],
      ['sync-chunk-writes', 'false'],
      ['white-list', 'false'],
    ]);
    const lines = fs.existsSync(properties) ? fs.readFileSync(properties, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const seen = new Set();
    const updated = lines.map((line) => {
      const key = line.split('=')[0];
      if (!desired.has(key)) return line;
      seen.add(key);
      return `${key}=${desired.get(key)}`;
    });
    for (const [key, value] of desired) if (!seen.has(key)) updated.push(`${key}=${value}`);
    if (!seen.has('rcon.password')) updated.push(`rcon.password=${crypto.randomBytes(18).toString('hex')}`);
    fs.writeFileSync(properties, updated.join('\n') + '\n', { mode: 0o600 });
  }

  async function startWorld(javaHome) {
    const marker = path.join(worldDir, 'server.jar');
    if (worldPid && ownedImpl(worldPid, marker) && await portProbe(serverHost, serverPort)) return;
    const existingPids = ownedPids(marker, execFileImpl);
    if (existingPids.length === 1 && await portProbe(serverHost, serverPort)) {
      worldPid = existingPids[0];
      return;
    }
    if (existingPids.length) await stopOne(existingPids[0], marker, worldState);
    let occupied = await portProbe(serverHost, serverPort);
    for (let attempt = 0; occupied && attempt < 20; attempt += 1) {
      await sleep(100);
      occupied = await portProbe(serverHost, serverPort);
    }
    if (occupied) throw new Error('world port already occupied by an unmanaged process');
    await ensureWorld();
    const log = fs.openSync(path.join(worldDir, 'server.log'), 'a');
    const child = spawnImpl(path.join(javaHome, 'bin', 'java'), ['-Xms1G', '-Xmx2G', '-jar', path.join(worldDir, 'server.jar'), 'nogui'], {
      cwd: worldDir, detached: true, stdio: ['ignore', log, log],
    });
    child.unref();
    fs.closeSync(log);
    worldPid = child.pid;
    writeJson(worldState, { pid: child.pid, worldDir, startedAt: Date.now() });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await portProbe(serverHost, serverPort)) return;
      if (!alive(child.pid)) throw new Error('world Java process exited');
      await sleep(500);
    }
    throw new Error('world port did not become ready');
  }

  async function startClient(javaHome) {
    const existing = readJson(clientState);
    const gamePids = clientPid && ownedImpl(clientPid, clientHome)
      ? [clientPid]
      : ownedPids(clientHome, execFileImpl).filter((pid) => cmdline(pid).includes('KnotClient'));
    let waitExisting = false;
    if (gamePids.length === 1) {
      try {
        await makeClient().info();
        clientPid = gamePids[0];
        return;
      } catch (error) {
        if (/no local client player|no_client_player/i.test(error.message)) {
          clientPid = gamePids[0];
          waitExisting = true;
        }
      }
    }
    if (!waitExisting) await stopOne(existing?.pid, clientHome, clientState);
    if (!fs.existsSync(tokenFile)) {
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
    }
    const tokenValue = token();
    const rpcPort = Number(rpc.port || 25600);
    const mcpConfig = {
      host: '127.0.0.1', port: rpcPort, token: tokenValue, requireAuth: env.HABITAT_MC_REQUIRE_AUTH !== '0', callTimeoutMs: 8000,
      worldIdKey: readJson(path.join(clientHome, 'config', 'mcpfabric.config.json'), {})?.worldIdKey || crypto.randomBytes(16).toString('hex'),
      enableWorldWrite: true, enableCommands: true, enablePlayerControl: true, enableVision: true,
      enableUiControl: false, enableSupervisedControl: false, supervisedWorlds: [], supervisedCommands: ['time', 'weather'],
    };
    writeJson(path.join(clientHome, 'config', 'mcpfabric.config.json'), mcpConfig);
    const profile = env.HABITAT_MC_FABRIC_PROFILE || 'fabric 1.21.4';
    const xdgData = path.join(clientHome, '.xdg', 'data');
    const managedJavaHome = path.join(xdgData, 'headlessmc', 'java', 'temurin', '21');
    const managedJavaTarget = env.HABITAT_MC_JAVA_HOME || path.join(runtimeRoot, 'java', 'jdk21');
    if (!fs.existsSync(managedJavaHome) && fs.existsSync(managedJavaTarget)) linkDirectory(managedJavaTarget, managedJavaHome);
    const javaArgs = [`-Dhmc.files.mc=${clientHome}`, `-Duser.home=${clientHome}`, ...(fs.existsSync(managedJavaHome) ? ['-Dhmc.java.download=false'] : [])];
    const childEnv = {
      ...process.env,
      HOME: clientHome,
      XDG_DATA_HOME: xdgData,
      XDG_CONFIG_HOME: path.join(clientHome, '.xdg', 'config'),
      XDG_STATE_HOME: path.join(clientHome, '.xdg', 'state'),
      XDG_CACHE_HOME: path.join(clientHome, '.xdg', 'cache'),
    };
    try {
      execFileImpl(path.join(javaHome, 'bin', 'java'), [...javaArgs, '-jar', path.join(clientHome, 'headlessmc.jar'), 'version', 'download', '1.21.4'], { cwd: clientHome, env: childEnv, stdio: 'inherit' });
    } catch (error) {
      if (!fs.existsSync(path.join(clientHome, 'versions', '1.21.4'))) throw error;
    }
    try {
      execFileImpl(path.join(javaHome, 'bin', 'java'), [...javaArgs, '-jar', path.join(clientHome, 'headlessmc.jar'), 'version', 'download', 'fabric', '1.21.4'], { cwd: clientHome, env: childEnv, stdio: 'inherit' });
    } catch (error) {
      if (!fs.existsSync(path.join(clientHome, 'versions', 'fabric-loader-0.20.1-1.21.4'))) throw error;
    }
    const gameDir = path.join(clientHome, 'fabric-1.21.4');
    fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true, mode: 0o700 });
    for (const name of ['mcpfabric.jar', 'fabric-api.jar']) {
      const source = path.join(clientHome, 'mods', name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(gameDir, 'mods', name));
    }
    writeJson(path.join(gameDir, 'config', 'mcpfabric.config.json'), mcpConfig);
    fs.writeFileSync(path.join(gameDir, 'options.txt'), 'multiplayerWarning:false\npauseOnLostFocus:false\n', { mode: 0o600 });
    if (!waitExisting) {
      const log = fs.openSync(path.join(clientHome, 'client.log'), 'a');
      const child = spawnImpl(path.join(javaHome, 'bin', 'java'), [...javaArgs, '-jar', path.join(clientHome, 'headlessmc.jar'), 'launch', ...profile.split(/\s+/), '--offline', `--server=${serverAddress}`, '-lwjgl'], {
        cwd: clientHome, env: childEnv, detached: true, stdio: ['ignore', log, log],
      });
      child.unref();
      fs.closeSync(log);
      clientPid = child.pid;
      writeJson(clientState, { pid: child.pid, clientHome, startedAt: Date.now() });
    }
    const deadline = Date.now() + Number(env.HABITAT_MC_CLIENT_START_TIMEOUT_MS || 900000);
    while (Date.now() < deadline) {
      const gamePid = ownedPids(clientHome, execFileImpl).find((pid) => cmdline(pid).includes('KnotClient'));
      if (gamePid) clientPid = gamePid;
      try {
        await makeClient().info();
        writeJson(clientState, { pid: clientPid, clientHome, startedAt: Date.now() });
        return;
      }
      catch (error) {
        lastError = error.message;
        if (/method not found|unknown method|unauthorized|forbidden/i.test(lastError)) throw error;
      }
      if (!alive(clientPid)) throw new Error('AI client Java process exited');
      await sleep(500);
    }
    throw new Error('mcpfabric RPC did not become ready');
  }

  async function stopOne(pid, marker, stateFile) {
    const pids = new Set([...(pid ? [pid] : []), ...ownedPids(marker, execFileImpl)]);
    for (const current of pids) {
      if (ownedImpl(current, marker)) {
        try { process.kill(-current, 'SIGTERM'); } catch {}
        try { killImpl(current, 'SIGTERM'); } catch {}
        const deadline = Date.now() + 6000;
        while (alive(current) && Date.now() < deadline) await sleep(100);
        if (alive(current)) {
          try { process.kill(-current, 'SIGKILL'); } catch {}
          try { killImpl(current, 'SIGKILL'); } catch {}
        }
      }
    }
    if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
  }

  async function provision() {
    if (topology !== 'local-wsl') throw new Error('provisioning is only supported for local-wsl');
    state = 'provisioning';
    checkpoint('PROVISION', '准备本地 MC 世界');
    const javaHome = await ensureJdk();
    await ensureClientRuntime(javaHome);
    await startWorld(javaHome);
    await startClient(javaHome);
    state = 'ready';
    lastError = null;
    checkpoint('READY', '本地 MC 世界与 AI 客户端已就绪');
    return status();
  }

  async function stop() {
    await stopOne(clientPid || readJson(clientState)?.pid, clientHome, clientState);
    clientPid = null;
    await stopOne(worldPid || readJson(worldState)?.pid, path.join(worldDir, 'server.jar'), worldState);
    worldPid = null;
    state = 'stopped';
    phase = 'STOPPED';
    return status();
  }

  async function backup() {
    await stop();
    const backupDir = path.join(root, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const archive = path.join(backupDir, `world-${Date.now()}.tar.gz`);
    const entries = ['world', 'eula.txt', 'ops.json', 'whitelist.json', 'banned-ips.json', 'banned-players.json']
      .filter((name) => fs.existsSync(path.join(worldDir, name)));
    execFileImpl('tar', ['-czf', archive, '-C', worldDir, ...entries]);
    return { archive, sha256: hashFile(archive), status: status() };
  }

  async function restore({ archive }) {
    const backupDir = path.join(root, 'data', 'backups');
    const source = fs.realpathSync(path.resolve(String(archive || '')));
    const relativeArchive = path.relative(backupDir, source);
    if (!relativeArchive || relativeArchive === '..' || relativeArchive.startsWith(`..${path.sep}`) || path.isAbsolute(relativeArchive)) throw new Error('restore archive must be inside data/backups');
    if (!fs.statSync(source).isFile()) throw new Error('restore archive is not a file');
    const javaHome = await ensureJdk();
    await ensureClientRuntime(javaHome);
    await stop();
    const work = path.join(root, 'state', 'mc-restore', `${Date.now()}-${process.pid}`);
    const staging = path.join(work, 'staging');
    const previous = path.join(work, 'previous');
    let moved = false;
    try {
      fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
      safeExtract(source, staging, execFileImpl);
      const allowed = new Set(['world', 'eula.txt', 'ops.json', 'whitelist.json', 'banned-ips.json', 'banned-players.json']);
      for (const name of fs.readdirSync(staging)) if (!allowed.has(name)) throw new Error(`unexpected restore entry: ${name}`);
      if (!fs.existsSync(path.join(staging, 'world'))) throw new Error('restore archive has no world data');
      if (fs.existsSync(worldDir)) {
        fs.renameSync(worldDir, previous);
        moved = true;
      }
      fs.mkdirSync(worldDir, { recursive: true, mode: 0o700 });
      for (const name of ['server.jar', 'server.properties']) {
        const oldFile = path.join(previous, name);
        if (fs.existsSync(oldFile)) fs.copyFileSync(oldFile, path.join(worldDir, name));
      }
      fs.cpSync(staging, worldDir, { recursive: true });
      await startWorld(javaHome);
      await startClient(javaHome);
      const observation = await makeClient().obs();
      if (observation?.mode !== 'play') throw new Error('restored world observation is not play');
      state = 'ready';
      lastError = null;
      checkpoint('READY', '世界恢复与 RPC 观测已验证');
      fs.rmSync(work, { recursive: true, force: true });
      return { ...status(), restored: true, archive: source, observation: observation.mode };
    } catch (error) {
      lastError = error.message;
      let rollback = 'not-needed';
      if (moved) {
        await stop().catch(() => {});
        fs.rmSync(worldDir, { recursive: true, force: true });
        fs.renameSync(previous, worldDir);
        try {
          await startWorld(javaHome);
          await startClient(javaHome);
          state = 'ready';
          lastError = null;
          checkpoint('READY', '恢复失败，已回滚到原世界');
          rollback = 'restored';
        } catch (rollbackError) {
          state = 'error';
          lastError = rollbackError.message;
          checkpoint('ERROR', '原世界回滚失败，需要人工恢复');
          rollback = 'degraded';
          error.message += `; rollback failed: ${rollbackError.message}`;
        }
      } else {
        state = 'error';
        checkpoint('ERROR', '世界恢复失败');
      }
      error.rollback = rollback;
      throw error;
    }
  }

  function status() {
    return {
      state,
      phase,
      topology,
      autoStart,
      worldPid,
      clientPid,
      serverAddress,
      rpcUrl,
      lastError,
    };
  }

  return {
    async start() {
      if (!autoStart) {
        await makeClient().info();
        state = 'ready';
        phase = 'READY';
        return status();
      }
      return provision();
    },
    stop,
    provision,
    backup,
    restore,
    status,
  };
}

export function createHandlers({ runtime }) {
  return {
    status: () => runtime.status(),
    provision: () => runtime.provision(),
    stop: () => runtime.stop(),
    backup: () => runtime.backup(),
    restore: (args) => runtime.restore(args),
  };
}
