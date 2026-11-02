// 验证运行时 lock、SBOM 哈希、组件字段和 Ed25519 签名。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'lock.json'), 'utf8'));
if (lock.schemaVersion !== 1 || !lock.bundle || !lock.version || !lock.source || !lock.sha256) throw new Error('invalid runtime lock');
if (!/^https:\/\//.test(lock.source)) throw new Error('runtime source must be HTTPS');
if (!/^[0-9a-f]{64}$/.test(lock.sha256)) throw new Error('invalid bundle sha256');
if (!Array.isArray(lock.components) || !lock.components.length) throw new Error('components required');
for (const component of lock.components) {
  if (!component.id || !component.version || !component.sha256 || !component.license) {
    throw new Error('component id/version/sha256/license required');
  }
}
const sbomHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'runtime', 'sbom.json'))).digest('hex');
if (sbomHash !== lock.sbomSha256) throw new Error('SBOM hash mismatch');
const sig = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'lock.sig.json'), 'utf8'));
const publicKey = fs.readFileSync(path.join(ROOT, 'runtime', 'release-public-key.pem'), 'utf8');
if (!crypto.verify(null, fs.readFileSync(path.join(ROOT, 'runtime', 'lock.json')), publicKey, Buffer.from(sig.signature, 'base64'))) {
  throw new Error('runtime lock signature invalid');
}
const revocations = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'revocations.json'), 'utf8'));
if (!Array.isArray(revocations.revoked)) throw new Error('invalid revocations');
console.log(`ok: runtime lock ${lock.bundle} ${lock.version} · ${lock.components.length} components · SBOM/signature valid`);
