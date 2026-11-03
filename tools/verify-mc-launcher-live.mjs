import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntime } from '../adapters/mc-launcher/provider.mjs';
import { EpisodeStore } from '../agent/episode-store.mjs';
import { NativeMcClient } from '../clients/mc-native.mjs';

const root = process.env.HABITAT_LAUNCHER_TEST_ROOT || `/tmp/habitat-launcher-live-${process.pid}`;
const worldDir = path.join(root, 'data', 'world-server');
fs.mkdirSync(worldDir, { recursive: true });
fs.copyFileSync(process.env.HABITAT_TEST_WORLD_SERVER_JAR || '/var/lib/habitat/world-server/server.jar', path.join(worldDir, 'server.jar'));
const episodes = new EpisodeStore({ root: path.join(root, 'episodes') });
const episode = episodes.create({ id: 'live-launcher', goal: '创建并进入真实本地世界', participants: ['system'] });
const env = {
  HABITAT_INSTANCE_ROOT: root,
  HABITAT_MC_TOPOLOGY: 'local-wsl',
  HABITAT_MC_LAUNCHER_AUTO_START: '1',
  HABITAT_MC_LAUNCHER_TEMPLATE: process.env.HABITAT_TEST_MC_TEMPLATE || '/opt/habitat/app/mc-native',
  HABITAT_JAVA_HOME: process.env.HABITAT_TEST_JAVA_HOME || '/opt/habitat/runtime/jdk25',
  HABITAT_MC_JAVA_HOME: process.env.HABITAT_TEST_MC_JAVA_HOME || '/opt/habitat/runtime/jdk21',
  HABITAT_MC_SERVER_ADDRESS: process.env.HABITAT_TEST_MC_SERVER_ADDRESS || '127.0.0.1:25566',
  HABITAT_MCPFABRIC_RPC: process.env.HABITAT_TEST_MC_RPC || 'http://127.0.0.1:25601/rpc',
  MCPFABRIC_TOKEN_FILE: path.join(root, 'config', 'mcpfabric.token'),
  HABITAT_MC_CLIENT_START_TIMEOUT_MS: '1800000',
  HABITAT_MC_REQUIRE_AUTH: '1',
};
const runtime = createRuntime({ env, episode, episodeStore: episodes });
let stopped = false;
let failed = false;
try {
  const started = await runtime.start();
  assert.equal(started.state, 'ready');
  assert.equal(started.phase, 'READY');
  assert.ok(started.worldPid && started.clientPid);
  const client = new NativeMcClient({ rpc: env.HABITAT_MCPFABRIC_RPC, token: fs.readFileSync(env.MCPFABRIC_TOKEN_FILE, 'utf8').trim() });
  const info = await client.info();
  assert.ok(info);
  const observation = await client.obs();
  assert.equal(observation.mode, 'play');
  assert.ok(Array.isArray(observation.self.pos));
  const again = await runtime.start();
  assert.equal(again.worldPid, started.worldPid);
  assert.equal(again.clientPid, started.clientPid);
  const backup = await runtime.backup();
  stopped = true;
  assert.ok(fs.existsSync(backup.archive));
  assert.ok(backup.sha256);
  assert.equal(episode.phase, 'READY');
  console.log(JSON.stringify({ world: started.state, rpc: 'ready', episode: episode.phase, backup: path.basename(backup.archive) }));
  console.log('ok: 真实 Java 世界、AI 客户端、RPC 观测、幂等停止与世界备份');
} catch (error) {
  failed = true;
  const logRoot = process.env.HABITAT_TEST_LOG_DIR || path.join(process.cwd(), '.tmp', 'mc-launcher-live-logs');
  fs.mkdirSync(logRoot, { recursive: true });
  for (const [name, file] of [['server.log', path.join(worldDir, 'server.log')], ['client.log', path.join(root, 'data', 'mc-client', 'client.log')]]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(logRoot, name));
  }
  throw error;
} finally {
  if (!stopped) await runtime.stop().catch(() => {});
  if (!failed) fs.rmSync(root, { recursive: true, force: true });
  else console.log('preserved test root:', root);
}
