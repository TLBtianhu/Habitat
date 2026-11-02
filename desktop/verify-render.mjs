import fs from 'node:fs';
import { AppRegistry } from './app-registry.mjs';
import { compose } from './compositor.mjs';
import { renderSvg } from './renderer.mjs';

const r = new AppRegistry();
r.open('mc', { kind: 'mc', view: { kind: 'firstPerson' } });
r.open('qq', { kind: 'qq' });
r.open('ide', { kind: 'ide' });
r.open('live', { kind: 'live' });
r.focus('mc');
r.background('qq');
r.close('live');

const frame = compose(r);
const svg = renderSvg(frame);
fs.writeFileSync('C:/Habitat/artifacts/desktop.svg', svg);
console.log('written artifacts/desktop.svg, layers=', frame.layers.length);
process.exit(0);
