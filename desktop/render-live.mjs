// 用真实世界快照渲染自研桌面：AppSession + ProjectionInput → FramePlan → SVG
import fs from 'node:fs';
import { AppRegistry } from './app-registry.mjs';
import { compose } from './compositor.mjs';
import { renderSvg } from './renderer.mjs';

const r = new AppRegistry();
r.open('mc', { kind: 'mc', view: { kind: 'firstPerson' } });
r.open('qq', { kind: 'qq' });
r.open('ide', { kind: 'ide' });
r.focus('mc');
r.background('qq');

const inputs = new Map([['mc', {
  kind: 'mc',
  view: { kind: 'firstPerson' },
  snapshot: { frame: { path: '/var/lib/habitat/artifacts/mc-pixels.jpg' } },
}]]);
const frame = compose(r, inputs);
fs.writeFileSync('/var/lib/habitat/artifacts/desktop-live.svg', renderSvg(frame));
console.log('written desktop-live.svg with client-provided pixels');
process.exit(0);
