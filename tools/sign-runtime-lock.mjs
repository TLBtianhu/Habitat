// 为 runtime/lock.json 生成真实 Ed25519 签名；私钥只存在受保护的本地配置中。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = process.env.HABITAT_RELEASE_SIGNING_PRIVATE || '/etc/habitat/release-signing-private.pem';
const publicPath = process.env.HABITAT_RELEASE_SIGNING_PUBLIC || path.join(ROOT, 'runtime', 'release-public-key.pem');
let privateKey;
let publicKey;
if (fs.existsSync(privatePath)) {
  privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath, 'utf8'));
  publicKey = crypto.createPublicKey(privateKey);
} else {
  const pair = crypto.generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));

const lockPath = path.join(ROOT, 'runtime', 'lock.json');
function canonical(file) {
  return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2) + '\n';
}
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.sbomSha256 = crypto.createHash('sha256').update(canonical(path.join(ROOT, 'runtime', 'sbom.json'))).digest('hex');
fs.writeFileSync(lockPath, canonical(lockPath));
const signature = crypto.sign(null, canonical(lockPath), privateKey).toString('base64');
fs.writeFileSync(path.join(ROOT, 'runtime', 'lock.sig.json'), JSON.stringify({
  algorithm: 'Ed25519',
  signature,
  publicKey: 'runtime/release-public-key.pem',
}, null, 2) + '\n');
console.log('runtime lock signed:', lock.bundle, lock.version);
