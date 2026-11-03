import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(repo, '.tmp', `mc-runtime-package-${process.pid}`);
const template = path.join(root, 'template');
const out = path.join(root, 'dist');
try {
  for (const rel of ['headlessmc.jar', 'headlessmc-lwjgl.jar', 'fabric-installer.jar', 'mods/mcpfabric.jar', 'mods/fabric-api.jar']) {
    fs.mkdirSync(path.dirname(path.join(template, rel)), { recursive: true });
    fs.writeFileSync(path.join(template, rel), `fixture:${rel}`);
  }
  const archive = path.join(out, 'mc-client-runtime-0.1.0.tar.gz');
  execFileSync(process.execPath, ['tools/build-mc-client-runtime.mjs', template, out], { cwd: repo, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/verify-mc-client-runtime.mjs', archive], { cwd: repo, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/verify-mc-runtime-download.mjs', archive], { cwd: repo, stdio: 'inherit' });
  console.log('ok: MC runtime package allowlist、hash、许可证与下载安装分支');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
