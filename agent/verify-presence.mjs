import assert from 'node:assert/strict';
import { ResidencePresence } from './residence-presence.mjs';

const presence = new ResidencePresence();
presence.update('system', { channel: 'system', state: 'online' });
presence.update('qq', { channel: 'qq', state: 'offline' });
assert.equal(presence.aggregate(), 'degraded');
presence.update('qq', { channel: 'qq', state: 'online' });
assert.equal(presence.aggregate(), 'ready');
presence.update('qq', { channel: 'qq', state: 'offline', enabled: false });
assert.equal(presence.aggregate(), 'ready', 'disabled residence 不计入聚合');
presence.update('system', { channel: 'system', state: 'offline' });
presence.update('qq', { channel: 'qq', state: 'offline', enabled: true });
assert.equal(presence.aggregate(), 'offline');
const snapshot = presence.snapshot();
assert.equal(snapshot.aggregate, 'offline');
assert.equal(snapshot.residences.length, 2);
console.log('ok: 分场所 online/degraded/offline、ready/degraded/offline 聚合与 disabled');
