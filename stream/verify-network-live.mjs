import assert from 'node:assert/strict';
import { RtmpNetworkPolicy } from './network-policy.mjs';
import { PlaybackVerifier } from './playback-verifier.mjs';
import { readLiveConfig } from './bilibili-live-config.mjs';
const config = readLiveConfig('/opt/habitat/config/bilibili-live.json');
const network = new RtmpNetworkPolicy();
const preflight = await network.check(config.rtmpUrl);
assert.equal(preflight.lastResult, 'reachable', JSON.stringify(preflight));
const verifier = new PlaybackVerifier({ outputStatus: () => ({ state: 'running' }), timeoutMs: 20000 });
let result;
for (let attempt = 1; attempt <= 3; attempt++) {
  result = await verifier.verifyNow();
  if (result.verified) break;
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(result.verified, true, JSON.stringify(result));
assert.equal(result.playbackDecoded, true);
assert.equal(result.liveStatus, 1);
console.log(JSON.stringify({ preflight: preflight.lastResult, verified: result.verified, liveStatus: result.liveStatus, playbackDecoded: result.playbackDecoded, lastCheckedAt: result.lastCheckedAt, lastVerifiedAt: result.lastVerifiedAt, lastError: result.lastError }));
verifier.stop();
