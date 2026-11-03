import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntime } from '../adapters/mc-launcher/provider.mjs';
import { EpisodeStore } from '../agent/episode-store.mjs';

const archive = path.resolve(process.argv[2]);
if (!archive) throw new Error('usage: node tools/verify-mc-runtime-download.mjs <archive.tar.gz>');
const sidecar = JSON.parse(fs.readFileSync(archive.replace(/\.tar\.gz$/, '.json'), 'utf8'));
const root = path.join(process.cwd(), '.tmp', `mc-runtime-download-${process.pid}`);
const archiveBytes = fs.readFileSync(archive);
const episodes = new EpisodeStore({ root: path.join(root, 'episodes') });
const episode = episodes.create({ id: 'runtime-download', goal: '验证下载安装', participants: ['system'] });
let worldUp = false;
let clientUp = false;
let nextPid = 7000;
try {
  fs.mkdirSync(path.join(root, 'fake-jdk', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fake-jdk', 'bin', 'java'), 'test');
  fs.mkdirSync(path.join(root, 'data', 'world-server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'world-server', 'server.jar'), 'test');
  const runtime = createRuntime({
    env: {
      HABITAT_INSTANCE_ROOT: root,
      HABITAT_MC_TOPOLOGY: 'local-wsl',
      HABITAT_MC_LAUNCHER_AUTO_START: '1',
      HABITAT_JAVA_HOME: path.join(root, 'fake-jdk'),
      HABITAT_MC_SERVER_ADDRESS: '127.0.0.1:25566',
      HABITAT_MCPFABRIC_RPC: 'http://127.0.0.1:25601/rpc',
      HABITAT_MC_CLIENT_RUNTIME_URL: 'https://github.com/TLBtianhu/Habitat/releases/download/mc-client-runtime-v0.1.0/mc-client-runtime-0.1.0.tar.gz',
      HABITAT_MC_CLIENT_RUNTIME_SHA256: sidecar.sha256,
      MCPFABRIC_TOKEN_FILE: path.join(root, 'config', 'mcpfabric.token'),
    },
    episode,
    episodeStore: episodes,
    fetchImpl: async () => new Response(archiveBytes, { status: 200 }),
    spawnImpl: (command, args) => {
      const child = { pid: ++nextPid, unref() {} };
      if (args.some((arg) => String(arg).endsWith('server.jar'))) worldUp = true;
      if (args.some((arg) => String(arg).endsWith('headlessmc.jar'))) clientUp = true;
      return child;
    },
    clientFactory: () => ({ info: async () => { if (!clientUp) throw new Error('rpc unavailable'); return { ok: true }; } }),
    portProbe: async () => worldUp,
    ownedImpl: () => true,
    killImpl: () => {},
    execFileImpl: (command, args, options) => {
      if (command === 'tar') return execFileSync(command, args, options);
      return '';
    },
  });
  const started = await runtime.start();
  assert.equal(started.state, 'ready');
  for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) {
    assert.ok(fs.existsSync(path.join(root, 'data', 'mc-client', rel)), rel);
  }
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'mc-client', 'licenses', 'mcpfabric-MIT.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'data', 'mc-client', 'config', 'mcpfabric.token')));
  await runtime.stop();
  console.log('ok: 下载归档 hash、白名单解压、许可证与 provider 启动分支');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
