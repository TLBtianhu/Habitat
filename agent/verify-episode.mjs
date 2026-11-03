import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EpisodeStore } from './episode-store.mjs';

const root = `/tmp/habitat-episode-test-${process.pid}`;
try {
  const store = new EpisodeStore({ root });
  const episode = store.create({ id: 'E1', goal: '在 MC 世界 X 生存并直播', participants: ['mc.world.X', 'bilibili.room.Y'] });
  assert.equal(episode.canRead('mc.world.X'), true);
  assert.equal(episode.canRead('bilibili.room.Y'), true);
  assert.equal(episode.canRead('qq.group.A'), false);
  assert.equal(episode.revision, 0);
  const checkpointId = episode.checkpointId;
  episode.checkpointState({ phase: 'PLAY', currentTask: '收集木头' });
  assert.notEqual(episode.checkpointId, checkpointId);
  assert.equal(episode.revision, 1);
  const write = episode.addPendingWrite('hls.stop');
  episode.confirmWrite(write.id, { stopped: true });
  assert.equal(episode.pendingWrites[0].status, 'confirmed');
  episode.pause();
  assert.equal(episode.canWrite('mc.world.X'), false);
  episode.resume();
  assert.equal(episode.canWrite('mc.world.X'), true);
  episode.handoffTo('qq.group.A', { by: 'owner', summary: '继续收集木头' });
  assert.equal(episode.canRead('qq.group.A'), true);
  assert.throws(() => episode.handoffTo('qq.group.B', { by: 'qq.group.A', summary: '非主人交接' }), /episode_handoff_requires_owner/);
  episode.complete();
  assert.equal(episode.canWrite('mc.world.X'), false);
  const summary = episode.summary();
  assert.equal(summary.pendingWriteCounts.confirmed, 1);
  assert.equal(summary.pendingWrites, undefined, '摘要不得展开原始 pending writes');
  store.save(episode);

  const restored = store.get('E1');
  assert.equal(restored.goal, '在 MC 世界 X 生存并直播');
  assert.equal(restored.checkpoint.currentTask, '收集木头');
  assert.equal(restored.status, 'completed');
  assert.equal(restored.pendingWrites[0].outcome.stopped, true);
  assert.equal(restored.originResidenceId, 'system');
  assert.equal(restored.handoff.toResidenceId, 'qq.group.A');
  assert.equal(restored.handoff.summary, '继续收集木头');
  assert.equal(restored.revision, episode.revision);
  assert.equal(restored.summary().revision, episode.revision);
  assert.equal(store.list().length, 1);
  console.log('ok: Episode 参与者、checkpoint、pending writes、暂停/恢复/结束与重启恢复');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
