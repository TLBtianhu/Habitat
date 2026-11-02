import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveOutlet } from './outlet-resolver.mjs';

const root = `/tmp/habitat-outlet-resolver-${process.pid}`;
const cacheDir = path.join(root, 'plugins');
const appRoot = path.join(cacheDir, 'installed', 'hls');
const manifestDir = path.join(appRoot, 'adapters', 'hls');
fs.mkdirSync(path.join(appRoot, 'tools'), { recursive: true });
fs.mkdirSync(manifestDir, { recursive: true });
fs.writeFileSync(path.join(appRoot, 'tools', 'wsl-pipeline-up.sh'), '#!/usr/bin/env bash\n');
const manifest = {
  schemaVersion: 1,
  id: 'hls',
  kind: 'hls',
  version: '0.3.0',
  lifecycle: 'outlet',
  entry: '../../tools/wsl-pipeline-up.sh',
  requires: ['desktop.capture', 'audio.capture'],
  tools: [],
};
fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(manifest));
let state = [{ id: 'hls', version: '0.1.0', enabled: true, revoked: false }];
const installer = { cacheDir, installed: () => state };
try {
  const installed = resolveOutlet({ name: 'hls', root, entries: { hls: '../tools/wsl-pipeline-up.sh' }, pluginInstaller: installer });
  assert.equal(installed.source, 'installed');
  assert.equal(installed.cwd, appRoot);
  assert.equal(installed.script, path.resolve(appRoot, 'tools', 'wsl-pipeline-up.sh'));

  state = [{ id: 'hls', enabled: false, revoked: false }];
  assert.throws(() => resolveOutlet({ name: 'hls', root, entries: { hls: '../tools/wsl-pipeline-up.sh' }, pluginInstaller: installer }), /disabled or revoked/);
  state = [{ id: 'hls', enabled: true, revoked: true }];
  assert.throws(() => resolveOutlet({ name: 'hls', root, entries: { hls: '../tools/wsl-pipeline-up.sh' }, pluginInstaller: installer }), /disabled or revoked/);

  state = [{ id: 'hls', enabled: true, revoked: false }];
  fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify({ ...manifest, entry: '../../../outside.sh' }));
  assert.throws(() => resolveOutlet({ name: 'hls', root, entries: { hls: '../tools/wsl-pipeline-up.sh' }, pluginInstaller: installer }), /escapes plugin directory/);

  state = [];
  const fallback = resolveOutlet({ name: 'hls', root, entries: { hls: '../tools/wsl-pipeline-up.sh' }, pluginInstaller: installer });
  assert.equal(fallback.source, 'builtin');
  console.log('ok: 已安装 Outlet 入口、目录边界、停用/撤销与内置回退规则');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
