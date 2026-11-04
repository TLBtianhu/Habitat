import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ScenePreviewService } from './scene-preview-service.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { BilibiliLiveSettings } from '../control/bilibili-live-settings.mjs';
import { publicLiveConfig, readLiveConfig, validateLiveConfig, writeLiveConfig } from './bilibili-live-config.mjs';

const root = path.join(process.cwd(), '.tmp', `bilibili-live-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const configFile = path.join(root, 'config', 'bilibili-live.json');
writeLiveConfig(configFile, { rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'secret-key' });
assert.throws(() => validateLiveConfig({ rtmpUrl: 'http://127.0.0.1/live', streamKey: 'x' }));
assert.throws(() => validateLiveConfig({ rtmpUrl: 'rtmp://user:pass@127.0.0.1/live', streamKey: 'x' }));
assert.equal(publicLiveConfig(readLiveConfig(configFile)).streamKeySet, true);
assert.ok(!JSON.stringify(publicLiveConfig(readLiveConfig(configFile))).includes('secret-key'));

let seq = 0;
const desktop = http.createServer((req, res) => {
  if (req.url === '/capture/open') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'capture-live', captureToken: 'capture-token' }));
    return;
  }
  if (req.url === '/capture/frame?id=capture-live') {
    seq += 1;
    res.writeHead(200, { 'content-type': 'image/png', 'x-frame-seq': String(seq), 'x-frame-at': String(1000 + seq) });
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    return;
  }
  if (req.url === '/capture/close') { res.end('{}'); return; }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => desktop.listen(0, '127.0.0.1', resolve));
const children = [];
function fakeFactory(config) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  child.stdin.write = () => true;
  child.stdin.end = () => child.emit('exit', 0);
  child.kill = () => {};
  children.push(child);
  return new BilibiliRtmpOutput({ target: config.rtmpUrl, streamKey: config.streamKey, spawnImpl: () => {
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }, stopTimeoutMs: 20 });
}
const scenePreview = new ScenePreviewService({
  desktopUrl: `http://127.0.0.1:${desktop.address().port}`,
  agentToken: 'agent-test', ownerToken: 'owner-test', port: 0, bilibiliConfigPath: configFile, bilibiliFactory: fakeFactory,
});
const settings = new BilibiliLiveSettings({ file: configFile, scenePreview });
try {
  assert.equal(settings.get().state, 'stopped');
  assert.equal(settings.get().configured, true);
  assert.equal(settings.get().verified, false);
  await scenePreview.startBilibili();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settings.get().applied, true);
  assert.equal(settings.get().verified, false);
  assert.ok(!JSON.stringify(settings.get()).includes('secret-key'));
  assert.throws(() => settings.save({ rtmpUrl: 'rtmp://127.0.0.1/other', streamKey: '' }), /stop the live output/);
  await scenePreview.stopBilibili();
  assert.equal(settings.get().applied, false);
  settings.save({ rtmpUrl: 'rtmp://127.0.0.1/other', streamKey: '' });
  assert.equal(readLiveConfig(configFile).streamKey, 'secret-key');
  await scenePreview.startBilibili();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settings.get().applied, true);
  assert.equal(children.length, 2);
  scenePreview.bilibili.markVerified(12345);
  assert.equal(settings.get().verified, true);
  assert.equal(settings.get().lastVerifiedAt, 12345);
  await scenePreview.stopAll();
  console.log('ok: B站 RTMP 配置脱敏、启停、更新隔离与真实验证状态字段');
} finally {
  await scenePreview.stopAll().catch(() => {});
  desktop.close();
  fs.rmSync(root, { recursive: true, force: true });
}
