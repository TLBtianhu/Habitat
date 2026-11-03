import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const archive = path.resolve(process.argv[2]);
if (!archive) throw new Error('usage: node tools/verify-mc-client-runtime.mjs <archive.tar.gz>');
const sidecar = JSON.parse(fs.readFileSync(archive.replace(/\.tar\.gz$/, '.json'), 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = path.join(process.cwd(), '.tmp', `mc-runtime-verify-${process.pid}`);
const allowed = new Set([
  'headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar',
  'mods/mcpfabric.jar', 'mods/fabric-api.jar',
  'licenses/HeadlessMC-MIT.txt', 'licenses/mcpfabric-MIT.txt',
  'licenses/Fabric-Installer-Apache-2.0.txt', 'licenses/Fabric-API-Apache-2.0.txt',
  'runtime-manifest.json', 'THIRD-PARTY-NOTICES.md',
]);
try {
  assert.equal(sha256(archive), sidecar.sha256);
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    if (entry.endsWith('/')) continue;
    const normalized = entry.replace(/^\.\//, '');
    if (!normalized || normalized === '.') continue;
    assert.ok(!normalized.startsWith('/') && !normalized.split('/').includes('..'), `unsafe path: ${entry}`);
    assert.ok(allowed.has(normalized), `unexpected runtime file: ${normalized}`);
  }
  fs.mkdirSync(root, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', root]);
  for (const file of sidecar.files) {
    assert.equal(sha256(path.join(root, file.path)), file.sha256, file.path);
    assert.equal(fs.statSync(path.join(root, file.path)).size, file.bytes, file.path);
  }
  const extracted = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter((entry) => entry && !entry.endsWith('/'));
  assert.equal(extracted.length, allowed.size);
  console.log(JSON.stringify({ ok: true, archive: path.basename(archive), files: extracted.length, bytes: sidecar.bytes }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
