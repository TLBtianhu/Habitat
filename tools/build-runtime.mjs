// 构建自包含 runtime：只复制二进制和必要许可证，不写开发设置/缓存。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2] || process.env.HABITAT_RUNTIME_SOURCE;
if (!SOURCE) throw new Error('用法: node tools/build-runtime.mjs <runtime-source-dir> [output.tar.gz]');
const OUT = process.argv[3] || path.join(ROOT, 'dist', 'habitat-runtime-core-0.1.1.tar.gz');
const STAGE = path.join(ROOT, 'dist', 'runtime-core-staging');
const CHROME = path.join(SOURCE, 'chrome', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const LIBS = [
  'libglib-2.0.so.0', 'libgobject-2.0.so.0', 'libnspr4.so', 'libnss3.so', 'libnssutil3.so',
  'libgio-2.0.so.0', 'libatk-1.0.so.0', 'libatk-bridge-2.0.so.0', 'libdbus-1.so.3',
  'libX11.so.6', 'libXcomposite.so.1', 'libXdamage.so.1', 'libXext.so.6', 'libXfixes.so.3',
  'libXrandr.so.2', 'libgbm.so.1', 'libexpat.so.1', 'libxcb.so.1', 'libxkbcommon.so.0',
  'libasound.so.2', 'libatspi.so.0', 'libplc4.so', 'libplds4.so', 'libgmodule-2.0.so.0',
  'libXrender.so.1', 'libdrm.so.2', 'libXau.so.6', 'libXdmcp.so.6', 'libXi.so.6', 'libbsd.so.0', 'libmd.so.0',
];
const PACKAGES = ['libglib2.0-0', 'libnspr4', 'libnss3', 'libatk1.0-0', 'libatk-bridge2.0-0',
  'libdbus-1-3', 'libx11-6', 'libxcomposite1', 'libxdamage1', 'libxext6', 'libxfixes3',
  'libxrandr2', 'libgbm1', 'libexpat1', 'libxcb1', 'libxkbcommon0', 'libasound2', 'libatspi2.0-0', 'libplc4', 'libplds4', 'libxrender1', 'libdrm2', 'libxau6', 'libxdmcp6', 'libxi6', 'libbsd0', 'libmd0'];

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const dir of ['node22', 'jdk21', 'chrome']) {
  if (!fs.existsSync(path.join(SOURCE, dir))) throw new Error('missing runtime directory: ' + dir);
  fs.cpSync(path.join(SOURCE, dir), path.join(STAGE, dir), { recursive: true, verbatimSymlinks: true });
}
const ldd = execFileSync('ldd', [CHROME], { encoding: 'utf8' });
const libRoot = path.join(STAGE, 'chrome-libs');
fs.mkdirSync(libRoot, { recursive: true });
for (const lib of LIBS) {
  const line = ldd.split(/\r?\n/).find((item) => item.includes('/' + lib));
  if (!line || !line.includes('=>')) throw new Error('host library not found: ' + lib);
  const source = line.split('=>')[1].trim().split(' ')[0];
  if (!fs.existsSync(source)) throw new Error('library path missing: ' + source);
  fs.copyFileSync(source, path.join(libRoot, lib));
}
const licenseRoot = path.join(libRoot, 'licenses');
fs.mkdirSync(licenseRoot, { recursive: true });
for (const pkg of PACKAGES) {
  const source = `/usr/share/doc/${pkg}/copyright`;
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(licenseRoot, `${pkg}.txt`));
}
const sums = [];
for (const name of fs.readdirSync(libRoot).sort()) {
  const file = path.join(libRoot, name);
  if (!fs.statSync(file).isFile()) continue;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  sums.push(`${hash}  ${name}`);
}
fs.writeFileSync(path.join(libRoot, 'SHA256SUMS'), sums.join('\n') + '\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('tar', ['-czf', OUT, '-C', STAGE, '.'], { stdio: 'inherit' });
const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex');
console.log(JSON.stringify({ output: OUT, sha256: archiveHash, libraries: LIBS.length }));
