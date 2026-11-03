import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntime } from './provider.mjs';
import { EpisodeStore } from '../../agent/episode-store.mjs';

const root = `/tmp/habitat-launcher-test-${process.pid}`;
const template = `${root}/template`;
for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) {
  fs.mkdirSync(path.dirname(path.join(template, rel)), { recursive: true });
  fs.writeFileSync(path.join(template, rel), 'test');
}
fs.mkdirSync(`${root}/fake-jdk/bin`, { recursive: true });
fs.writeFileSync(`${root}/fake-jdk/bin/java`, 'test');
fs.mkdirSync(`${root}/data/world-server`, { recursive: true });
fs.writeFileSync(`${root}/data/world-server/server.jar`, 'test');
const episodes = new EpisodeStore({ root: `${root}/episodes` });
const episode = episodes.create({ id: 'launcher-episode', goal: '创建并进入本地世界', participants: ['system'] });
const spawned = [];
const killed = [];
let worldUp = false;
let clientUp = false;
let nextPid = 5000;
const env = {
  HABITAT_INSTANCE_ROOT: root,
  HABITAT_MC_TOPOLOGY: 'local-wsl',
  HABITAT_MC_LAUNCHER_AUTO_START: '1',
  HABITAT_MC_LAUNCHER_TEMPLATE: template,
  HABITAT_JAVA_HOME: `${root}/fake-jdk`,
  HABITAT_MC_SERVER_ADDRESS: '127.0.0.1:25566',
  HABITAT_MCPFABRIC_RPC: 'http://127.0.0.1:25601/rpc',
  MCPFABRIC_TOKEN_FILE: `${root}/config/mcpfabric.token`,
};
const runtime = createRuntime({
  env,
  episode,
  episodeStore: episodes,
  spawnImpl: (command, args) => {
    const child = { pid: ++nextPid, unref() {} };
    spawned.push({ command, args, pid: child.pid });
    if (args.some((arg) => String(arg).endsWith('server.jar'))) worldUp = true;
    if (args.some((arg) => String(arg).endsWith('headlessmc.jar'))) clientUp = true;
    return child;
  },
  clientFactory: () => ({ info: async () => { if (!clientUp) throw new Error('rpc unavailable'); return { ok: true }; } }),
  portProbe: async () => worldUp,
  ownedImpl: () => true,
  killImpl: (pid, signal) => killed.push({ pid, signal }),
  execFileImpl: (command, args) => {
    if (command === 'tar' && args[0] === '-czf') {
      fs.writeFileSync(args[1], 'backup');
      return '';
    }
    return '';
  },
});
try {
  const started = await runtime.start();
  assert.equal(started.state, 'ready');
  assert.equal(started.phase, 'READY');
  assert.ok(started.worldPid && started.clientPid);
  assert.equal(spawned.length, 2);
  assert.equal(episode.phase, 'READY');
  assert.equal(episode.participants.includes('mc-launcher.local'), true);
  assert.equal(episode.participants.includes('mc.world.current'), true);
  assert.ok(episode.revision > 0);
  await runtime.start();
  assert.equal(spawned.length, 2, '重复启动不得创建第二套进程');
  const backup = await runtime.backup();
  assert.ok(fs.existsSync(backup.archive));
  assert.ok(backup.sha256);
  assert.equal(killed[0].pid, started.clientPid, '先停 AI 客户端');
  assert.equal(killed[1].pid, started.worldPid, '后停世界进程');
  const stopped = runtime.status();
  assert.equal(stopped.state, 'stopped');
  assert.equal(JSON.stringify(stopped).includes('mcpfabric.token'), false);
  console.log('ok: mc-launcher provision、同级 Episode、幂等、停止顺序与无凭证备份');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
