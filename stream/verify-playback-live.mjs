import assert from 'node:assert/strict';
import { PlaybackVerifier } from './playback-verifier.mjs';
const verifier = new PlaybackVerifier({ outputStatus: () => ({ state: 'running' }), timeoutMs: 20000 });
try {
  const status = await verifier.verifyNow();
  assert.equal(status.verified, true, JSON.stringify(status));
  assert.equal(status.playbackDecoded, true);
  assert.equal(status.liveStatus, 1);
  assert.ok(status.lastVerifiedAt);
  console.log(JSON.stringify({ state: status.state, verified: status.verified, lastCheckedAt: status.lastCheckedAt, lastVerifiedAt: status.lastVerifiedAt, liveStatus: status.liveStatus, playbackDecoded: status.playbackDecoded, consecutiveFailures: status.consecutiveFailures, lastError: status.lastError }));
} finally {
  verifier.stop();
}
