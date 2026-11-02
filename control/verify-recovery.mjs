import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RecoveryManager } from './recovery.mjs';
import { EpisodeStore } from '../agent/episode-store.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';
import { SkillLibrary } from '../agent/skill-library.mjs';

const root = `/tmp/habitat-recovery-test-${process.pid}`;
const file = `${root}/lifecycle.json`;
const episodeStore = new EpisodeStore({ root: `${root}/episodes` });
const afterAction = new AfterActionStore({ file: `${root}/after.jsonl` });
const skillLibrary = new SkillLibrary({ file: `${root}/skills.json` });
const manager = new RecoveryManager({ file, episodeStore, afterAction, skillLibrary });
try {
  assert.equal(manager.boot().lastShutdownAbnormal, false);
  assert.equal(manager.ready().state, 'running');
  manager.stopping();
  manager.stopped();
  assert.equal(manager.boot().lastShutdownAbnormal, false);
  manager.stopping();
  const abnormal = manager.boot();
  assert.equal(abnormal.lastShutdownAbnormal, true, '未正常停止必须标为异常');

  const episode = episodeStore.get(process.env.HABITAT_EPISODE_ID || 'live-current') || episodeStore.create({ id: 'live-current', goal: 'recovery', participants: ['system'] });
  const write = episode.addPendingWrite('demo.action', { args: {}, residenceId: 'system' });
  episodeStore.save(episode);
  afterAction.record({ taskId: write.id, residenceId: 'system', goal: 'demo.action', checks: [{ name: 'evidence', ok: true, evidence: 'persisted' }] });
  await manager.recover();
  assert.equal(episodeStore.get('live-current').pendingWrites[0].status, 'confirmed');
  assert.equal(manager.status().recoveryRequired, false);
  assert.equal(skillLibrary.list().length, 1);
  console.log('ok: 正常/异常停止识别、只读恢复、pending 清理与成功技能门槛');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
