import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Episode } from './episode.mjs';
import { ResidenceMemoryStore } from './residence-memory-store.mjs';
import { MemorySlice } from './memory-slice.mjs';

const root = `/tmp/habitat-memory-slice-test-${process.pid}`;
try {
  const store = new ResidenceMemoryStore({ root });
  const episode = Episode.create({ id: 'E1', goal: '在 MC 世界 X 生存并直播', participants: ['mc.world.X', 'bilibili.room.Y'] });
  const mc = new MemorySlice({ store, episode, residenceId: 'mc.world.X' });
  const bili = new MemorySlice({ store, episode, residenceId: 'bilibili.room.Y' });
  const qq = new MemorySlice({ store, episode, residenceId: 'qq.group.A' });
  store.remember('core shared fact', { scope: 'core', mode: 'persistent' });
  mc.remember('collect wood', { scope: 'episode' });
  assert.equal(bili.recall('collect')[0].fact, 'collect wood', 'B站应读取共同 Episode');
  assert.equal(qq.recall('collect').length, 0, 'QQ 不应读取无关 Episode');
  assert.equal(bili.recall('core')[0].fact, 'core shared fact');

  mc.remember('mc private social', { scope: 'residence', isPrivate: true });
  assert.equal(mc.recall('private').length, 1, '来源场所可读取自己的私有记忆');
  assert.equal(bili.recall('private').length, 0, '私有社交记忆不跨场所');
  qq.remember('qq local', { scope: 'residence' });
  assert.equal(qq.recall('local')[0].fact, 'qq local');
  assert.equal(qq.context().episode, null);
  assert.equal(bili.context().episode.goal, '在 MC 世界 X 生存并直播');

  store.remember('console private social', { scope: 'residence:system', isPrivate: true });
  episode.handoffTo('qq.group.A', { by: 'owner', summary: '继续共同任务' });
  episode.addPendingWrite('demo.write', { args: { token: 'secret-pending-data' } });
  const qqContext = qq.context();
  assert.equal(qqContext.episode.goal, '在 MC 世界 X 生存并直播');
  assert.equal(qqContext.episode.handoff.toResidenceId, 'qq.group.A');
  assert.equal(qqContext.episode.pendingWriteCounts.pending, 1);
  assert.equal(JSON.stringify(qqContext).includes('secret-pending-data'), false, '任务摘要不得泄漏 pending 参数');
  assert.equal(qq.recall('console private').length, 0, '交接任务不得带入控制台私有社交记忆');

  assert.throws(() => mc.remember('core unauthorized', { scope: 'core' }), /core_write_requires_owner/);
  mc.remember('core approved', { scope: 'core', approvedBy: 'owner' });
  episode.pause();
  assert.throws(() => mc.remember('paused write', { scope: 'episode' }), /episode_write_not_allowed/);
  episode.resume();
  mc.remember('resumed write', { scope: 'episode' });
  episode.complete();
  assert.throws(() => mc.remember('ended write', { scope: 'episode' }), /episode_write_not_allowed/);
  console.log('ok: core+episode+residence 合并读取、MC+B站共享、QQ 隔离、私有记忆与显式写入');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
