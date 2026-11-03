import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { instancePaths } from './instance-paths.mjs';

const root = path.join(process.cwd(), '.tmp', `instance-paths-${process.pid}`);
const paths = instancePaths({ HABITAT_INSTANCE_ROOT: root });
for (const [name, value] of Object.entries(paths)) {
  if (name === 'root') continue;
  assert.ok(value.startsWith(root + path.sep), `${name} escaped root`);
}
assert.throws(() => instancePaths({ HABITAT_INSTANCE_ROOT: root, HABITAT_DATA_ROOT: '/var/lib/habitat' }), /child of the instance root/);
assert.throws(() => instancePaths({ HABITAT_INSTANCE_ROOT: root, HABITAT_CONFIG_ROOT: '../outside' }), /child of the instance root/);
try {
  const envFile = execFileSync(process.execPath, ['tools/write-instance-env.mjs', '--root', root], { encoding: 'utf8' }).trim();
  const values = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), JSON.parse(line.slice(index + 1))];
  }));
  assert.equal(values.HABITAT_MC_LAUNCHER_AUTO_START, '0');
  assert.equal(values.HOME, path.join(root, 'data', 'home'));
  assert.equal(values.HABITAT_EPISODE_DIR, path.join(root, 'data', 'episodes'));
  assert.equal(values.HABITAT_LLM_CONFIG, path.join(root, 'config', 'llm.json'));
  for (const [key, value] of Object.entries(values)) {
    if (key === 'PATH' || key === 'LD_LIBRARY_PATH' || key === 'HABITAT_MC_LAUNCHER_AUTO_START' || key === 'HABITAT_INSTANCE_ROOT') continue;
    assert.ok(value.startsWith(root + path.sep), `${key} escaped root: ${value}`);
  }
  const text = fs.readFileSync(envFile, 'utf8');
  assert.equal(text.includes('/var/lib/habitat'), false);
  assert.equal(text.includes('/etc/habitat'), false);
  assert.equal(text.includes('/home/' + 'tlb3'), false);
  console.log('ok: 单根路径、越界拒绝、无秘密 EnvironmentFile 与 MC autoStart=0');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
