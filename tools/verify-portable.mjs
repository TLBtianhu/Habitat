// 干净环境便携验收：runtime 自包含、生产依赖齐全、测试不写应用目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.argv[2] || path.join(os.homedir(), '.local', 'share', 'habitat-portable-test');
const app = path.join(root, 'app');
const runtime = path.join(root, 'runtime');
const data = path.join(root, 'data');
const config = path.join(root, 'config');
for (const rel of ['package.json', 'agent/verify-episode.mjs', 'agent/verify-memory-slice.mjs', 'adapters/verify-plugin-registry.mjs']) {
  if (!fs.existsSync(path.join(app, rel))) throw new Error('portable app missing: ' + rel);
}
for (const rel of ['node22/bin/node', 'jdk21/bin/java', 'chrome/chrome-headless-shell-linux64/chrome-headless-shell']) {
  if (!fs.existsSync(path.join(runtime, rel))) throw new Error('portable runtime missing: ' + rel);
}
for (const rel of ['node_modules/ws/package.json', 'node_modules/@resvg/resvg-js/package.json']) {
  if (!fs.existsSync(path.join(app, rel))) throw new Error('portable production dependency missing: ' + rel);
}
for (const rel of ['.tmp', 'dist', 'artifacts', 'memory', 'episodes', 'outbox', 'pump', 'system-chat.jsonl', 'control-tasks.json', 'after-action.jsonl', 'utterances.jsonl', 'stage/diagnostics.json']) {
  if (fs.existsSync(path.join(app, rel))) throw new Error('portable app contains runtime state: ' + rel);
}
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(config, { recursive: true });
const node = path.join(runtime, 'node22', 'bin', 'node');
const env = { ...process.env, HABITAT_OUTBOX: path.join(data, 'outbox.json'), HABITAT_MEMORY_DIR: path.join(data, 'memory'), HABITAT_EPISODE_DIR: path.join(data, 'episodes') };
for (const test of ['agent/verify-episode.mjs', 'agent/verify-memory-slice.mjs', 'adapters/verify-plugin-registry.mjs']) {
  execFileSync(node, [test], { cwd: app, env, stdio: 'inherit' });
}
fs.writeFileSync(path.join(data, 'portable-smoke.txt'), 'portable smoke passed\n');
if (!fs.existsSync(path.join(data, 'portable-smoke.txt'))) throw new Error('portable data directory is not writable');
console.log('ok: 干净便携目录、runtime 自包含、生产依赖与测试通过');
