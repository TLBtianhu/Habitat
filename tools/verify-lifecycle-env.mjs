import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadInstanceEnv } from './lifecycle-env.mjs';

const root = path.join(process.cwd(), '.tmp', `lifecycle-env-${process.pid}`);
fs.mkdirSync(path.join(root, 'state'), { recursive: true });
const envFile = path.join(root, 'state', 'instance.env');
try {
  fs.writeFileSync(envFile, [
    'HABITAT_LIFECYCLE_FILE="/opt/habitat/data/lifecycle.json"',
    'HABITAT_EPISODE_DIR="/opt/habitat/data/episodes"',
    'HABITAT_AFTER_ACTION_FILE="/opt/habitat/data/after-action.jsonl"',
    'HABITAT_SKILL_LIBRARY="/opt/habitat/data/skill-library.json"',
    'HOME="/opt/habitat/data/home"',
    'PATH="/opt/habitat/runtime/node22/bin:/usr/bin:/bin"',
    '',
  ].join('\n'), { mode: 0o600 });
  const env = { HABITAT_AFTER_ACTION_FILE: '/explicit/after-action.jsonl' };
  const loaded = loadInstanceEnv({ root, envFile, env });
  assert.equal(loaded, env);
  assert.equal(env.HABITAT_INSTANCE_ROOT, root);
  assert.equal(env.HABITAT_LIFECYCLE_FILE, '/opt/habitat/data/lifecycle.json');
  assert.equal(env.HABITAT_EPISODE_DIR, '/opt/habitat/data/episodes');
  assert.equal(env.HABITAT_AFTER_ACTION_FILE, '/explicit/after-action.jsonl');
  assert.equal(env.HABITAT_SKILL_LIBRARY, '/opt/habitat/data/skill-library.json');
  assert.equal(env.HOME, '/opt/habitat/data/home');
  assert.equal(env.PATH, '/opt/habitat/runtime/node22/bin:/usr/bin:/bin');
  const empty = {};
  loadInstanceEnv({ root, envFile: path.join(root, 'state', 'missing.env'), env: empty });
  assert.equal(empty.HABITAT_INSTANCE_ROOT, root);
  assert.equal(empty.HABITAT_LIFECYCLE_FILE, undefined);
  console.log('ok: lifecycle CLI uses instance env and preserves explicit path overrides');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
