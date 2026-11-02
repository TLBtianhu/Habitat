// Desktop 验收：AppSession 是真源，Surface/FramePlan 只是投影
import assert from 'node:assert/strict';
import { AppRegistry, AppState } from './app-registry.mjs';
import { project } from './projection.mjs';
import { compose } from './compositor.mjs';

const r = new AppRegistry();
r.open('mc', { kind: 'mc', view: { kind: 'firstPerson' } });
r.open('qq', { kind: 'qq' });

console.log('[1] 打开应用');
assert.equal(r.list().length, 2);
assert.equal(r.current(), null);
console.log('  ok');

console.log('[2] 聚焦只改变 AppSession，Surface 是映射');
r.focus('mc');
const mc = r.list().find((s) => s.appId === 'mc');
const surface = project(mc);
assert.equal(mc.state, AppState.FOCUSED);
assert.equal(surface.layout.space, 'full');
assert.equal(surface.kind, 'mc');
console.log('  ok');

console.log('[3] 后台应用不出主画面，但仍在任务栏');
r.background('qq');
const frame = compose(r);
assert.equal(frame.main, 'mc');
assert.ok(frame.taskbar.find((t) => t.appId === 'qq'));
assert.ok(!frame.surfaces.find((s) => s.appId === 'qq') || frame.surfaces.find((s) => s.appId === 'qq').layout.space === 'hidden');
console.log('  ok');

console.log('[4] 关闭后不再有 Surface');
r.close('qq');
assert.equal(project(r.list().find((s) => s.appId === 'qq')), null);
console.log('  ok');

console.log('Desktop 验收通过');
process.exit(0);
