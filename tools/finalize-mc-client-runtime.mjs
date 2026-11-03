import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sidecarFile = path.resolve(process.argv[2] || 'dist/mc-client-runtime-0.1.0.json');
const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
const source = process.env.HABITAT_MC_CLIENT_RUNTIME_SOURCE || 'https://github.com/TLBtianhu/Habitat/releases/download/mc-client-runtime-v0.1.0/mc-client-runtime-0.1.0.tar.gz';
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: { component: { type: 'application', name: sidecar.bundle, version: sidecar.version } },
  components: sidecar.files.map((file) => {
    const componentVersion = file.path.startsWith('headlessmc') ? sidecar.versions.headlessmc
      : file.path === 'mods/mcpfabric.jar' ? sidecar.versions.mcpfabric
        : file.path === 'mods/fabric-api.jar' ? sidecar.versions.fabricApi
          : file.path === 'fabric-installer.jar' ? sidecar.versions.fabricInstaller : sidecar.version;
    const license = file.path === 'mods/mcpfabric.jar' || file.path.startsWith('headlessmc') ? 'MIT' : 'Apache-2.0';
    return {
      type: 'library',
      name: file.path,
      version: componentVersion,
      hashes: [{ alg: 'SHA-256', content: file.sha256 }],
      licenses: [{ license: { id: license } }],
    };
  }),
};
const sbomFile = path.resolve('runtime/mc-client-sbom.json');
fs.mkdirSync(path.dirname(sbomFile), { recursive: true });
fs.writeFileSync(sbomFile, JSON.stringify(sbom, null, 2) + '\n');
const lock = {
  schemaVersion: 1,
  bundle: sidecar.bundle,
  version: sidecar.version,
  platform: sidecar.platform,
  distribution: 'built-not-published',
  source,
  sha256: sidecar.sha256,
  sbom: 'runtime/mc-client-sbom.json',
  sbomSha256: crypto.createHash('sha256').update(fs.readFileSync(sbomFile, 'utf8').replaceAll('\r\n', '\n')).digest('hex'),
  files: sidecar.files,
  versions: sidecar.versions,
};
fs.writeFileSync('runtime/mc-client-lock.json', JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify({ lock: 'runtime/mc-client-lock.json', sbom: 'runtime/mc-client-sbom.json', source, sha256: lock.sha256 }, null, 2));
