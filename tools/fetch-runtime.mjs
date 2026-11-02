// 运行时下载与安装：唯一源、SHA256、安全解包、staging 校验后切换，不默认写系统目录。
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync(new URL('../runtime/manifest.json', import.meta.url), 'utf8'));
const dest = process.argv[2] || process.env.HABITAT_RUNTIME_DIR || path.join(os.homedir(), '.local', 'share', 'habitat', 'runtime');
const parent = path.dirname(dest);
const staging = `${dest}.staging-${process.pid}`;
const backup = `${dest}.backup-${process.pid}`;
const file = path.join(parent, `runtime-${process.pid}.tar.gz`);
fs.mkdirSync(parent, { recursive: true });

function validateArchive() {
  const entries = execFileSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean);
  if (entries.length > 20000) throw new Error('运行时文件数过多');
  for (const entry of entries) {
    const name = entry.replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('运行时包含不安全路径: ' + name);
  }
  const verbose = execFileSync('tar', ['-tvzf', file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (verbose.split(/\r?\n/).some((line) => /^[lh]/.test(line) || /\s(?:->|link to)\s/.test(line))) {
    throw new Error('运行时包含链接，拒绝直接解包；请在目标机重建链接');
  }
}

function verifyRuntime(root) {
  for (const [name, cmd, args] of [
    ['node', `${root}/node22/bin/node`, ['--version']],
    ['java', `${root}/jdk21/bin/java`, ['-version']],
    ['chrome', `${root}/chrome/chrome-headless-shell-linux64/chrome-headless-shell`, ['--version']],
  ]) {
    console.log(name, execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || 'ok');
  }
}

try {
  const response = await fetch(manifest.url);
  if (!response.ok) throw new Error(`runtime download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 2 * 1024 * 1024 * 1024) throw new Error('运行时下载超过 2GB');
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024 * 1024) throw new Error('运行时下载超过 2GB');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== manifest.sha256) throw new Error(`sha256 mismatch: ${sha} != ${manifest.sha256}`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  validateArchive();
  fs.mkdirSync(staging, { recursive: true });
  execFileSync('tar', ['xzf', file, '-C', staging]);
  verifyRuntime(staging);

  if (fs.existsSync(dest)) {
    if (fs.lstatSync(dest).isSymbolicLink()) throw new Error('运行时目标是 symlink，拒绝覆盖');
    fs.renameSync(dest, backup);
  }
  try {
    fs.renameSync(staging, dest);
  } catch (error) {
    if (fs.existsSync(backup)) fs.renameSync(backup, dest);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  console.log('installed', manifest.id, manifest.version, '->', dest);
} finally {
  fs.rmSync(file, { force: true });
  fs.rmSync(staging, { recursive: true, force: true });
}
