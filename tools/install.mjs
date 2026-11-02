// 安装到用户态环境：默认 LOCALAPPDATA，不写 ProgramData，不要求管理员。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : path.join(localAppData, 'Habitat');

const app = path.join(target, 'app');
const data = path.join(target, 'data');
const config = path.join(target, 'config');
const tmp = path.join(target, 'tmp');
for (const d of [app, data, config, tmp]) fs.mkdirSync(d, { recursive: true });

const zip = path.join(ROOT, 'dist', 'fishbowl-v0.1.zip');
if (!fs.existsSync(zip)) throw new Error('先运行 tools/package.mjs');
const entries = execFileSync('tar.exe', ['-tf', zip], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean);
if (entries.length > 20000) throw new Error('安装包文件数过多');
for (const entry of entries) {
  const name = entry.replaceAll('\\', '/');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
    throw new Error('安装包包含不安全路径: ' + name);
  }
}
execFileSync('tar.exe', ['-xf', zip, '-C', app], { stdio: 'inherit' });
const nested = path.join(app, 'Fishbowl');
if (fs.existsSync(nested)) {
  fs.cpSync(nested, app, { recursive: true, force: true });
  fs.rmSync(nested, { recursive: true, force: true });
}

const cfg = path.join(config, 'worlds.json');
if (!fs.existsSync(cfg)) fs.copyFileSync(path.join(ROOT, 'worlds.json'), cfg);

fs.writeFileSync(path.join(target, 'install.json'), JSON.stringify({
  installedAt: new Date().toISOString(),
  source: zip,
  layout: { app, data, config, tmp },
}, null, 2));

console.log('installed to', target);
console.log('  app   =', app);
console.log('  data  =', data);
console.log('  config=', config);
console.log('  tmp   =', tmp);
