import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'package', 'Fishbowl');
for (const required of [
  'agent/run-continuous.mjs', 'clients/mcpfabric-token.mjs', 'package.json', 'package-lock.json',
  'tools/install-user.ps1', 'tools/install.mjs', 'tools/wsl-install.sh', 'tools/verify-install.sh',
  'tools/build-runtime.mjs', 'tools/build-win-exe.mjs', 'tools/win/setup.ps1', 'tools/win/HabitatSetup.cs', 'tools/win/HabitatConsole.cs',
  'tools/verify-win-release.mjs', 'tools/instance-supervisor.mjs', 'tools/verify-instance.mjs', 'tools/verify-settings-live.mjs', 'tools/win/verify-installed-instance.ps1',
  'control/instance-settings.mjs', 'control/verify-instance-settings.mjs', 'tools/win/settings.ps1',
  'node_modules/ws/package.json', 'node_modules/@resvg/resvg-js/package.json',
]) assert.ok(fs.existsSync(path.join(root, required)), 'missing ' + required);
for (const forbidden of ['tools/bridge.mjs', 'display/server.mjs']) {
  assert.equal(fs.existsSync(path.join(root, forbidden)), false, 'forbidden ' + forbidden);
}

const installer = fs.readFileSync(path.join(root, 'tools/install-user.ps1'), 'utf8');
assert.ok(installer.includes('.local/share/habitat'));
assert.ok(installer.includes('useradd -m habitat'));
assert.ok(installer.includes('-u $script:WslUser'));
assert.equal(installer.includes('wsl -d Ubuntu -u root -- systemctl'), false);
assert.ok(installer.includes('RuntimeSha256'));
assert.ok(installer.includes('fetch-runtime.mjs'));
const runtimeBuild = fs.readFileSync(path.join(root, 'tools/build-runtime.mjs'), 'utf8');
assert.ok(runtimeBuild.includes('verbatimSymlinks'));
const supervisor = fs.readFileSync(path.join(root, 'tools/instance-supervisor.mjs'), 'utf8');
assert.ok(supervisor.includes('HABITAT_LLM_CONFIG'));
assert.ok(supervisor.includes('recovery_required'));
const installMjs = fs.readFileSync(path.join(root, 'tools/install.mjs'), 'utf8');
assert.ok(installMjs.includes('LOCALAPPDATA'));
const wslInstall = fs.readFileSync(path.join(root, 'tools/wsl-install.sh'), 'utf8');
assert.ok(wslInstall.includes('.install-staging-'));
assert.ok(wslInstall.includes('.install-backup-'));
assert.ok(wslInstall.includes('HABITAT_USER'));

let scanned = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) { walk(file); continue; }
    if (!/\.(?:mjs|js|json|md|sh|ps1|ya?ml|txt)$/i.test(name) || stat.size > 2 * 1024 * 1024) continue;
    scanned++;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes(['a11e9f', '83618f4451a79533ef02db51d4'].join('')), false, 'dev token in ' + file);
    assert.equal(/\bsk-[A-Za-z0-9]{20,}\b/.test(text), false, 'possible API key in ' + file);
  }
})(root);
console.log(`ok: 发行包结构、用户目录安装、回滚脚本、旧面排除与 ${scanned} 个文本文件秘密扫描通过`);
