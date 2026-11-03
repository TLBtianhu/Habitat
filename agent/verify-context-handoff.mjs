import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EpisodeStore } from './episode-store.mjs';
import { ResidenceMemoryStore } from './residence-memory-store.mjs';
import { ContextAssembler } from './memory-slice.mjs';

const root = `/tmp/habitat-context-handoff-${process.pid}`;
try {
  const episodes = new EpisodeStore({ root: `${root}/episodes` });
  const memory = new ResidenceMemoryStore({ root: `${root}/memory` });
  const episode = episodes.create({
    id: 'shared-task',
    goal: '收集木头并完成任务',
    participants: ['system', 'mc.world.current'],
    originResidenceId: 'system',
  });
  episode.checkpointState({ phase: 'PLAY', currentTask: '收集木头', activeResidence: 'system' });
  memory.remember('console private social', { scope: 'residence:system', isPrivate: true });
  memory.remember('mc private social', { scope: 'residence:mc.world.current', isPrivate: true });
  episode.addPendingWrite('demo.write', { args: { token: 'pending-secret' } });
  assert.throws(() => episode.handoffTo('qq.group.A', { by: 'qq.group.A', summary: '非主人接管' }), /episode_handoff_requires_owner/);
  episode.handoffTo('qq.group.A', { by: 'owner', summary: '继续收集木头' });
  const beforeCheckpoint = episode.revision;
  episode.checkpointState({ phase: 'PLAY', currentTask: '在 MC 中继续收集木头', activeResidence: 'mc.world.current' });
  episodes.save(episode);

  const restored = episodes.get('shared-task');
  assert.ok(restored.revision > beforeCheckpoint);
  assert.equal(restored.originResidenceId, 'system');
  assert.equal(restored.handoff.toResidenceId, 'qq.group.A');
  assert.equal(restored.checkpoint.currentTask, '在 MC 中继续收集木头');
  memory.remember('qq private social', { scope: 'residence:qq.group.A', isPrivate: true });
  const assembler = new ContextAssembler({ store: memory, episode: restored });
  const qq = assembler.assemble({ residenceId: 'qq.group.A' });
  const mc = assembler.assemble({ residenceId: 'mc.world.current' });
  assert.equal(qq.episode.id, 'shared-task');
  assert.equal(mc.episode.id, 'shared-task');
  assert.equal(qq.episode.revision, restored.revision);
  assert.equal(mc.episode.revision, restored.revision);
  assert.equal(qq.episode.pendingWriteCounts.pending, 1);
  assert.equal(JSON.stringify(qq.episode).includes('pending-secret'), false);
  assert.equal(qq.residence.some((fact) => fact.includes('console private')), false);
  assert.equal(mc.residence.some((fact) => fact.includes('qq private')), false);
  assert.equal(qq.residence.some((fact) => fact.includes('mc private')), false);
  assert.equal(mc.residence.some((fact) => fact.includes('console private')), false);
  console.log('ok: 控制台→QQ→MC 共享任务 revision、重启恢复、owner 交接、摘要与社交记忆隔离');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
