// 编译真实 Windows 控制台与安装 EXE，使用系统 .NET Framework，不要求管理员。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'win');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) throw new Error('.NET Framework csc.exe not found');
const zip = path.join(ROOT, 'dist', 'fishbowl-v0.1.zip');
if (!fs.existsSync(zip)) throw new Error('先运行 tools/package.mjs');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'tools', 'win'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'payload'), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, 'tools', 'win'))) {
  if (/\.(?:ps1|psm1)$/.test(name)) fs.copyFileSync(path.join(ROOT, 'tools', 'win', name), path.join(OUT, 'tools', 'win', name));
}
fs.copyFileSync(path.join(ROOT, 'tools', 'install-user.ps1'), path.join(OUT, 'tools', 'win', 'install-user.ps1'));
fs.copyFileSync(zip, path.join(OUT, 'payload', 'fishbowl-v0.1.zip'));
for (const name of ['lock.json', 'sbom.json', 'lock.sig.json', 'release-public-key.pem', 'revocations.json']) {
  fs.mkdirSync(path.join(OUT, 'runtime'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'runtime', name), path.join(OUT, 'runtime', name));
}
const consoleOutput = path.join(OUT, 'tools', 'win', 'HabitatConsole.exe');
execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', `/out:${consoleOutput}`, path.join(ROOT, 'tools', 'win', 'HabitatConsole.cs')], { stdio: 'inherit' });
const setupOutput = path.join(OUT, 'tools', 'win', 'HabitatSetup.exe');
const resources = [
  [consoleOutput, 'HabitatConsole.exe'],
  [path.join(OUT, 'payload', 'fishbowl-v0.1.zip'), 'payload.fishbowl-v0.1.zip'],
];
for (const name of ['lock.json', 'sbom.json', 'lock.sig.json', 'release-public-key.pem', 'revocations.json']) {
  resources.push([path.join(OUT, 'runtime', name), `runtime.${name}`]);
}
for (const name of ['client.ps1', 'settings.ps1', 'lifecycle.psm1', 'habitat.ps1', 'resume-habitat.ps1', 'setup.ps1', 'install-user.ps1']) {
  resources.push([path.join(OUT, 'tools', 'win', name), `tools.win.${name}`]);
}
execFileSync(csc, [
  '/nologo', '/optimize+', '/target:exe', `/out:${setupOutput}`,
  ...resources.map(([file, name]) => `/resource:${file},${name}`),
  path.join(ROOT, 'tools', 'win', 'HabitatSetup.cs'),
], { stdio: 'inherit' });
for (const output of [consoleOutput, setupOutput]) {
  if (fs.readFileSync(output).subarray(0, 2).toString() !== 'MZ') throw new Error('invalid Windows EXE: ' + output);
  console.log('built', output);
}
const sums = [];
for (const rel of ['tools/win/HabitatSetup.exe', 'tools/win/HabitatConsole.exe', 'payload/fishbowl-v0.1.zip']) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, rel))).digest('hex');
  sums.push(`${hash}  ${rel}`);
}
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
