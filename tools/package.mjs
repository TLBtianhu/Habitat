// 打包分发：只收当前模块，排除旧无鉴权面、开发秘密、运行数据与 node_modules。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'package', 'Fishbowl');
const ZIP = path.join(DIST, 'fishbowl-v0.1.zip');

const INCLUDE = [
  'README.md', 'ARCHITECTURE.md', 'PLAN.md', 'worlds.json', 'package.json', 'package-lock.json',
  'tools', 'director', 'runtime', 'stage', 'stream', 'agent', 'identity', 'config',
  'desktop', 'voice', 'audio', 'control', 'clients', 'adapters', 'plugins', 'mcp',
  'docs',
];
const EXCLUDE = /node_modules|artifacts|\.git|dist|\.log$|mc-1\.21\.4|work\/|world-server|stage\/hls|tools\/bridge\.mjs|tools\/play-demo\.mjs|tools\/bili-danmaku-ws\.mjs|tools\/test-|clients\/test-|clients\/_|\.tmp|\.env(?:\..*)?$|__pycache__/;
const TEXT = /\.(?:mjs|js|json|md|sh|ps1|ya?ml|txt)$/i;
const DEV_TOKEN = ['a11e9f', '83618f4451a79533ef02db51d4'].join('');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

function copy(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(STAGE, rel);
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(src)) copy(path.join(rel, name));
    return;
  }
  if (EXCLUDE.test(rel.replaceAll('\\', '/'))) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

for (const rel of INCLUDE) copy(rel);

// 便携版必须自包含：只安装并携带生产依赖，不携带开发目录或开发依赖。
execFileSync(process.platform === 'win32' ? (process.env.comspec || 'cmd.exe') : 'npm',
  process.platform === 'win32'
    ? ['/c', 'npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: STAGE, stdio: 'inherit' });

let count = 0;
let textCount = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) { walk(file); continue; }
    count++;
    if (TEXT.test(name) && stat.size <= 2 * 1024 * 1024) {
      textCount++;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(DEV_TOKEN)) throw new Error('发行包包含开发 mcpfabric token: ' + file);
      if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) throw new Error('发行包疑似包含 LLM API key: ' + file);
    }
  }
})(STAGE);

for (const required of [
  'agent/run-continuous.mjs', 'clients/mcpfabric-token.mjs', 'package.json', 'package-lock.json',
  'tools/install-user.ps1', 'tools/wsl-install.sh', 'control/server.mjs', 'desktop/compositor-service.mjs',
]) {
  if (!fs.existsSync(path.join(STAGE, required))) throw new Error('发行包缺少必需文件: ' + required);
}
for (const forbidden of ['tools/bridge.mjs', 'display/server.mjs']) {
  if (fs.existsSync(path.join(STAGE, forbidden))) throw new Error('发行包包含旧控制面: ' + forbidden);
}

fs.mkdirSync(DIST, { recursive: true });
if (fs.existsSync(ZIP)) fs.rmSync(ZIP);
execFileSync(process.platform === 'win32' ? 'tar.exe' : 'zip',
  process.platform === 'win32'
    ? ['-a', '-c', '-f', ZIP, '-C', path.dirname(STAGE), 'Fishbowl']
    : ['-qr', ZIP, 'Fishbowl'],
  { cwd: path.dirname(STAGE), stdio: 'inherit' });
if (fs.readFileSync(ZIP).subarray(0, 2).toString() !== 'PK') throw new Error('portable package is not a ZIP archive');

const kb = Math.round(fs.statSync(ZIP).size / 1024);
console.log(`package: ${ZIP} · ${count} files (${textCount} scanned) · ${kb} KB`);
