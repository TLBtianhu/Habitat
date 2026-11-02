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
  const checkpointId = episode.checkpointId;
  episode.checkpointState({ phase: 'PLAY', currentTask: '收集木头' });
  assert.notEqual(episode.checkpointId, checkpointId);
  const write = episode.addPendingWrite('hls.stop');
  episode.confirmWrite(write.id, { stopped: true });
  assert.equal(episode.pendingWrites[0].status, 'confirmed');
  episode.pause();
  assert.equal(episode.canWrite('mc.world.X'), false);
  episode.resume();
  assert.equal(episode.canWrite('mc.world.X'), true);
  episode.complete();
  assert.equal(episode.canWrite('mc.world.X'), false);
  store.save(episode);

  const restored = store.get('E1');
  assert.equal(restored.goal, '在 MC 世界 X 生存并直播');
  assert.equal(restored.checkpoint.currentTask, '收集木头');
  assert.equal(restored.status, 'completed');
  assert.equal(restored.pendingWrites[0].outcome.stopped, true);
  assert.equal(store.list().length, 1);
  console.log('ok: Episode 参与者、checkpoint、pending writes、暂停/恢复/结束与重启恢复');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
