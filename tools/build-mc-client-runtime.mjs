import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const template = path.resolve(process.argv[2] || '/opt/habitat/app/mc-native');
const outDir = path.resolve(process.argv[3] || 'dist');
const version = process.env.HABITAT_MC_CLIENT_RUNTIME_VERSION || '0.1.0';
const staging = path.join(outDir, `.mc-client-runtime-${process.pid}`);
const archive = path.join(outDir, `mc-client-runtime-${version}.tar.gz`);
const manifestFile = path.join(outDir, `mc-client-runtime-${version}.json`);
const files = [
  'headlessmc.jar',
  'headlessmc-lwjgl.jar',
  'fabric-installer.jar',
  'mods/mcpfabric.jar',
  'mods/fabric-api.jar',
];
const licenses = [
  'HeadlessMC-MIT.txt',
  'mcpfabric-MIT.txt',
  'Fabric-Installer-Apache-2.0.txt',
  'Fabric-API-Apache-2.0.txt',
];
const licenseDir = path.resolve('adapters/mc-launcher/licenses');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const metadata = (jar, entry) => {
  try {
    return JSON.parse(execFileSync('unzip', ['-p', jar, entry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; }
};
const manifestVersion = (jar) => {
  try {
    const text = execFileSync('unzip', ['-p', jar, 'META-INF/MANIFEST.MF'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return text.match(/^Implementation-Version:\s*(.+)$/mi)?.[1]?.trim() || 'unverified';
  } catch { return 'unverified'; }
};

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const artifacts = [];
  for (const rel of files) {
    const source = path.join(template, rel);
    if (!fs.existsSync(source)) throw new Error(`missing runtime file: ${rel}`);
    const destination = path.join(staging, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    artifacts.push({ path: rel, sha256: sha256(destination), bytes: fs.statSync(destination).size });
  }
  for (const name of licenses) {
    const source = path.join(licenseDir, name);
    if (!fs.existsSync(source)) throw new Error(`missing license notice: ${name}`);
    const destination = path.join(staging, 'licenses', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  const versions = {
    headlessmc: manifestVersion(path.join(template, 'headlessmc.jar')),
    mcpfabric: metadata(path.join(template, 'mods/mcpfabric.jar'), 'fabric.mod.json')?.version || 'unverified',
    fabricApi: metadata(path.join(template, 'mods/fabric-api.jar'), 'fabric.mod.json')?.version || 'unverified',
    fabricInstaller: manifestVersion(path.join(template, 'fabric-installer.jar')),
  };
  const notices = `# Third-party notices\n\nThis archive contains only launcher programs and license notices. It does not contain Minecraft assets, libraries, worlds, accounts, tokens, logs, or caches.\n\n| Component | Version | License | Source |\n| --- | --- | --- | --- |\n| HeadlessMC / headlessmc-lwjgl | ${versions.headlessmc} | MIT | https://github.com/headlesshq/headlessmc |\n| mcpfabric | ${versions.mcpfabric} | MIT | https://github.com/denfry/mcpfabric |\n| Fabric Installer | ${versions.fabricInstaller} | Apache-2.0 | https://github.com/FabricMC/fabric-installer |\n| Fabric API | ${versions.fabricApi} | Apache-2.0 | https://github.com/FabricMC/fabric |\n\nSee the corresponding files under licenses/. Minecraft and its assets are downloaded separately from their official sources and are not redistributed by this archive.\n`;
  fs.writeFileSync(path.join(staging, 'THIRD-PARTY-NOTICES.md'), notices);
  const manifest = {
    schemaVersion: 1,
    bundle: 'habitat-mc-client-runtime',
    version,
    platform: 'linux-x64',
    files: artifacts,
    versions,
    licenses: licenses.map((name) => `licenses/${name}`),
  };
  fs.writeFileSync(path.join(staging, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('tar', ['-czf', archive, '-C', staging, '.']);
  const result = { ...manifest, archive: path.basename(archive), sha256: sha256(archive), bytes: fs.statSync(archive).size };
  fs.writeFileSync(manifestFile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ archive, sha256: result.sha256, bytes: result.bytes, versions }, null, 2));
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
