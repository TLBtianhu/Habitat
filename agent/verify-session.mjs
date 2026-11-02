import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AppSessionManager } from './app-session.mjs';
import { AppRegistry } from '../desktop/app-registry.mjs';
import { compose } from '../desktop/compositor.mjs';
import { publishSessionSnapshot, readSessionSnapshot } from '../desktop/session-store.mjs';

const file = `/tmp/habitat-session-test-${process.pid}.json`;
try {
  const agent = new AppSessionManager();
  agent.open('mc', { kind: 'mc', view: { kind: 'firstPerson' } });
  agent.open('qq', { kind: 'qq' });
  agent.focus('mc');

  const obs = agent.obs();
  assert.equal(obs.mc.state, 'focused');
  assert.equal(JSON.stringify(obs).includes('frame'), false, 'obs 不得包含像素帧');

  publishSessionSnapshot(agent, file);
  const outlet = new AppRegistry().restore(readSessionSnapshot(file));
  const present = compose(outlet, new Map([['mc', {
    kind: 'mc',
    snapshot: { frame: { path: '/tmp/only-for-viewers.jpg' } },
  }]]));
  assert.equal(present.main, 'mc');
  assert.equal(present.surfaces.find((s) => s.appId === 'mc').snapshot.frame.path, '/tmp/only-for-viewers.jpg');
  assert.equal(JSON.stringify(agent.obs()).includes('only-for-viewers'), false, 'present 不得回流进 obs');

  agent.focus('qq');
  publishSessionSnapshot(agent, file);
  outlet.restore(readSessionSnapshot(file));
  assert.equal(compose(outlet).main, 'qq');

  agent.close('mc');
  assert.equal(compose(new AppRegistry().restore(agent.snapshot())).surfaces.some((s) => s.appId === 'mc'), false);
  console.log('ok: 单一 AppSession；obs 仅文本；present 可独立携带像素');
} finally {
  try { fs.unlinkSync(file); } catch {}
}
