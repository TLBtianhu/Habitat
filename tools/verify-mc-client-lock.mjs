import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const lock = JSON.parse(fs.readFileSync('runtime/mc-client-lock.json', 'utf8'));
const sbom = JSON.parse(fs.readFileSync(lock.sbom, 'utf8'));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).digest('hex');
assert.equal(lock.schemaVersion, 1);
assert.equal(lock.bundle, 'habitat-mc-client-runtime');
assert.equal(lock.platform, 'linux-x64');
assert.match(lock.source, /^https:\/\/github\.com\/TLBtianhu\/Habitat\/releases\/download\/mc-client-runtime-v/);
assert.match(lock.sha256, /^[a-f0-9]{64}$/);
assert.equal(hash(lock.sbom), lock.sbomSha256);
assert.equal(sbom.bomFormat, 'CycloneDX');
assert.equal(sbom.components.length, lock.files.length);
for (const file of lock.files) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.ok(file.bytes > 0);
  assert.ok(sbom.components.some((component) => component.name === file.path && component.hashes[0].content === file.sha256));
}
console.log(`ok: MC runtime lock ${lock.version}, ${lock.files.length} hashed components, SBOM verified (${lock.distribution})`);
