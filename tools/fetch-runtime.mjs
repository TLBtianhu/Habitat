// 运行时安装：先验证 lock/SBOM/撤销，再下载、解包、校验组件并原子切换。
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'lock.json'), 'utf8'));
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'verify-runtime-lock.mjs')], { stdio: 'inherit' });
const revocations = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'revocations.json'), 'utf8'));
if (revocations.revoked.some((item) => item === lock.sha256 || item === `${lock.bundle}:${lock.version}`)) {
  throw new Error('runtime bundle is revoked');
}
const manifest = { id: lock.bundle, version: lock.version, url: lock.source, sha256: lock.sha256 };
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
  for (const line of verbose.split(/\r?\n/)) {
    if (!/^[lh]/.test(line)) continue;
    const [left, target] = line.split(/\s(?:->|link to)\s/);
    if (!target) throw new Error('无法解析运行时链接');
    const source = left.trim().split(/\s+/).pop();
    if (path.posix.isAbsolute(target)) throw new Error('运行时包含绝对链接');
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), target));
    if (resolved === '..' || resolved.startsWith('../')) throw new Error('运行时包含逃逸链接');
  }
}

function verifyRuntime(root) {
  for (const component of lock.components.filter((item) => item.required && item.path)) {
    const file = path.join(root, component.path);
    if (!fs.existsSync(file)) throw new Error(`missing runtime component: ${component.id}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== component.sha256) throw new Error(`component hash mismatch: ${component.id}`);
  }
  for (const [name, cmd, args] of [
    ['node', `${root}/node22/bin/node`, ['--version']],
    ['java', `${root}/jdk21/bin/java`, ['-version']],
    ['chrome', `${root}/chrome/chrome-headless-shell-linux64/chrome-headless-shell`, ['--version']],
  ]) {
    console.log(name, execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || 'ok');
  }
}

try {
  const archive = process.env.HABITAT_RUNTIME_ARCHIVE;
  if (archive) {
    fs.copyFileSync(archive, file);
  } else {
    const response = await fetch(manifest.url);
    if (!response.ok) throw new Error(`runtime download failed: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 2 * 1024 * 1024 * 1024) throw new Error('运行时下载超过 2GB');
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024 * 1024) throw new Error('运行时下载超过 2GB');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha !== manifest.sha256) throw new Error(`sha256 mismatch: ${sha} != ${manifest.sha256}`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
  }
  const archiveSha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (archiveSha !== manifest.sha256) throw new Error(`sha256 mismatch: ${archiveSha} != ${manifest.sha256}`);
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
