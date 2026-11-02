import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { PluginInstaller, extractZipSafe } from './plugin-installer.mjs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = `/tmp/habitat-plugin-installer-test-${process.pid}`;
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/qq/manifest.json'), 'utf8'));
const artifactDir = path.join(cacheDir, 'artifact');
fs.mkdirSync(artifactDir, { recursive: true });
for (const rel of ['adapters/qq/manifest.json', 'adapters/qq/provider.mjs', 'clients/onebot.mjs', 'clients/onebot-supervisor.mjs', 'agent/residence-policy.mjs']) {
  const dst = path.join(artifactDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
}
fs.cpSync(path.join(ROOT, 'node_modules', 'ws'), path.join(artifactDir, 'node_modules', 'ws'), { recursive: true });
const zipPath = path.join(cacheDir, 'app-qq.zip');
execFileSync(process.platform === 'win32' ? 'tar.exe' : 'zip',
  process.platform === 'win32' ? ['-a', '-c', '-f', zipPath, '-C', artifactDir, '.'] : ['-qr', zipPath, '.'],
  { cwd: artifactDir, stdio: 'inherit' });
const zipBytes = fs.readFileSync(zipPath);
const baseIndex = {
  schemaVersion: 1,
  channel: 'stable',
  apiRange: '^1.0.0',
  signature: { algorithm: 'Ed25519', file: 'index.sig.json', publicKey: 'release-public-key.pem' },
  revocations: 'revocations.json',
  plugins: [{
    id: 'qq', version: '0.1.0', kind: 'adapter', entry: 'adapters/qq/manifest.json',
    lifecycle: manifest.lifecycle, capabilities: manifest.capabilities, scopes: manifest.scopes,
    permissions: manifest.permissions, license: 'MIT',
    artifact: { file: 'dist/app-qq.zip', url: 'APP_QQ_URL', sha256: crypto.createHash('sha256').update(zipBytes).digest('hex') },
    revoked: false,
  }],
};
const ownerFile = `/tmp/habitat-plugin-owner-${process.pid}.token`;
fs.writeFileSync(ownerFile, 'owner-test');
const index = {
  ...baseIndex,
  plugins: [
    { ...baseIndex.plugins[0], artifact: { ...baseIndex.plugins[0].artifact, url: 'APP_QQ_URL' } },
    { ...baseIndex.plugins[0], id: 'bad', artifact: { ...baseIndex.plugins[0].artifact, sha256: '0'.repeat(64), url: 'APP_BAD_URL' } },
    { ...baseIndex.plugins[0], id: 'revoked', revoked: true, artifact: { ...baseIndex.plugins[0].artifact, url: 'APP_REVOKED_URL' } },
    { ...baseIndex.plugins[0], id: 'remote-revoked', artifact: { ...baseIndex.plugins[0].artifact, url: 'APP_REMOTE_REVOKED_URL' } },
  ],
};
const revocations = { schemaVersion: 1, revoked: ['remote-revoked'] };
let canonical;
let signature;
let revocationSignature;
let server;
try {
  server = http.createServer((req, res) => {
    if (req.url === '/index.json') { res.end(JSON.stringify(index)); return; }
    if (req.url === '/index.sig.json') { res.end(JSON.stringify({ algorithm: 'Ed25519', signature })); return; }
    if (req.url === '/revocations.json') { res.end(JSON.stringify(revocations)); return; }
    if (req.url === '/revocations.sig.json') { res.end(JSON.stringify({ algorithm: 'Ed25519', signature: revocationSignature })); return; }
    if (req.url === '/release-public-key.pem') { res.end(publicPem); return; }
    if (req.url === '/app-qq.zip') { res.end(zipBytes); return; }
    if (req.url === '/bad-signature.json') { res.end(JSON.stringify({ algorithm: 'Ed25519', signature: 'bad' })); return; }
    if (req.url === '/app-bad.zip') { res.end(zipBytes); return; }
    if (req.url === '/app-revoked.zip') { res.end(zipBytes); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  index.plugins[0].artifact.url = `http://127.0.0.1:${port}/app-qq.zip`;
  index.plugins[1].artifact.url = `http://127.0.0.1:${port}/app-bad.zip`;
  index.plugins[2].artifact.url = `http://127.0.0.1:${port}/app-revoked.zip`;
  index.plugins[3].artifact.url = `http://127.0.0.1:${port}/app-qq.zip`;
  canonical = JSON.stringify(index, null, 2) + '\n';
  signature = crypto.sign(null, canonical, privateKey).toString('base64');
  revocationSignature = crypto.sign(null, JSON.stringify(revocations, null, 2) + '\n', privateKey).toString('base64');
  const installer = new PluginInstaller({ indexUrl: `http://127.0.0.1:${port}/index.json`, cacheDir });
  const installed = await installer.install('qq');
  assert.equal(installed.id, 'qq');
  assert.equal(installer.installed().length, 1);
  const registry = installer.registry([], {
    outboxFile: `${cacheDir}/outbox.json`,
    providerContext: {
      env: { HABITAT_ONEBOT_WS_URL: 'ws://test.invalid' },
      onebotClientFactory: () => ({ sendGroupMsg: async () => ({ message_id: 42 }) }),
      onebotSupervisorFactory: () => ({
        start: async () => {}, stop: async () => {}, status: () => ({ state: 'ready' }),
        obs: () => ({ available: true, recent: [], new: [] }), complete: () => {},
      }),
      policy: { authorizeReply: () => ({ allowed: true, reason: 'owner_test' }), noteOutput: () => {} },
      getResidenceContext: () => ({ kind: 'group', peerId: '123', residenceId: 'qq.group.123' }),
    },
  });
  await registry.start('qq');
  assert.equal((await registry.call('qq.reply', { text: 'installed' })).message_id, 42);
  await registry.stop('qq');
  assert.equal(installer._cachedIndex(new Error('offline')).plugins[0].id, 'qq');
  const baseDirs = [path.join(ROOT, 'adapters')];
  installer.disable('qq');
  assert.throws(() => installer.registry(baseDirs).getTool('qq.reply'), /unknown tool/);
  installer.enable('qq');
  assert.ok(installer.registry(baseDirs).getTool('qq.reply'));
  installer.revoke('qq');
  assert.throws(() => installer.registry(baseDirs).getTool('qq.reply'), /unknown tool/);
  await assert.rejects(async () => installer.enable('qq'), /revoked/);
  installer.unrevoke('qq');
  assert.throws(() => installer.registry(baseDirs).getTool('qq.reply'), /unknown tool/);
  installer.enable('qq');
  assert.ok(installer.registry(baseDirs).getTool('qq.reply'));
  installer.uninstall('qq');
  assert.equal(installer.installed().length, 0);
  await assert.rejects(() => installer.install('remote-revoked'), /revoked/);
  await assert.rejects(() => installer.install('bad'), /hash mismatch/);
  await assert.rejects(() => installer.install('revoked'), /revoked/);
  await assert.rejects(() => installer.install('qq', { approvedBy: 'model' }), /owner approval/);

  const badSignature = new PluginInstaller({ indexUrl: `http://127.0.0.1:${port}/bad-signature.json`, cacheDir });
  await assert.rejects(() => badSignature.install('qq'), /signature invalid/);

  const evil = `/tmp/habitat-evil-${process.pid}.zip`;
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const code = `import zipfile; z=zipfile.ZipFile(${JSON.stringify(evil)}, 'w'); z.writestr('../evil.txt', 'bad'); z.close()`;
  const { execFileSync } = await import('node:child_process');
  execFileSync(python, process.platform === 'win32' ? ['-3', '-c', code] : ['-c', code]);
  assert.throws(() => extractZipSafe(evil, `/tmp/habitat-evil-out-${process.pid}`));
  fs.rmSync(evil, { force: true });
  console.log('ok: owner-approved 安装、验签、哈希、撤销、拒绝模型安装与路径穿越');
} finally {
  server?.close();
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.rmSync(ownerFile, { force: true });
}
