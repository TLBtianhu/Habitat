import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RtmpNetworkPolicy } from './network-policy.mjs';
import { readLiveConfig } from './bilibili-live-config.mjs';
const root = path.join(process.cwd(), '.tmp', `real-socks5-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const file = path.join(root, 'stream-network.json');
const policy = new RtmpNetworkPolicy({ file });
const config = readLiveConfig('/opt/habitat/config/bilibili-live.json');
try {
  policy.save({ mode: 'socks5', proxy: { host: '127.0.0.1', port: 7897 } });
  const result = await policy.check(config.rtmpUrl);
  assert.equal(result.lastResult, 'reachable', JSON.stringify(result));
  assert.equal(result.lastError, null);
  assert.equal(result.proxyConfigured, true);
  console.log(JSON.stringify({ mode: result.mode, lastResult: result.lastResult, lastCheckedAt: result.lastCheckedAt, supported: result.supported, lastError: result.lastError }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
