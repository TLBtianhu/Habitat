import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AppSessionManager } from '../agent/app-session.mjs';
import { CompositorRuntime } from './compositor-runtime.mjs';

const file = `/tmp/habitat-compositor-test-${process.pid}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const provider = {
  attached: 0,
  detached: 0,
  pulls: 0,
  attachSurface() { this.attached += 1; },
  detachSurface() { this.detached += 1; },
  async pullFrame() {
    this.pulls += 1;
    return { kind: 'mc', snapshot: { frame: { path: '/tmp/test-only-mc.jpg' } } };
  },
  describe() { return { attached: this.attached, pulls: this.pulls }; },
};

try {
  const sessions = new AppSessionManager();
  sessions.open('desktop', { kind: 'desktop', system: true });
  sessions.open('mc', { kind: 'mc', view: { kind: 'firstPerson' } });
  sessions.open('qq', { kind: 'qq' });
  sessions.focus('mc');
  fs.writeFileSync(file, JSON.stringify(sessions.snapshot()));

  const runtime = new CompositorRuntime({
    registry: sessions,
    providers: new Map([['mc', provider]]),
    sessionFile: file,
    render: (plan) => Buffer.from(JSON.stringify(plan)),
  });
  assert.equal(runtime.describe().producing, false);
  assert.equal(provider.pulls, 0, '无消费者不得生产像素');

  const hls = await runtime.openCapture({ consumer: 'hls', fps: 20 });
  await sleep(80);
  assert.equal(runtime.describe().producing, true);
  assert.equal(provider.attached, 1);
  assert.ok(provider.pulls > 0);
  const hlsFrame = runtime.getCaptureFrame(hls.id, hls.captureToken);
  assert.ok(hlsFrame.data.length > 0);
  assert.throws(() => runtime.getCaptureFrame(hls.id, 'wrong-token'), /capture token required/);
  assert.equal('captureToken' in runtime.listCaptures().find((c) => c.id === hls.id), false);

  const qq = await runtime.openCapture({ consumer: 'qq-share', consumerApp: 'qq', fps: 20 });
  await sleep(80);
  const qqPlan = JSON.parse(runtime.getCaptureFrame(qq.id, qq.captureToken).data.toString());
  assert.equal(qqPlan.surfaces.some((s) => s.appId === 'qq'), false, 'QQ 默认排除自己的窗口');
  assert.equal(provider.attached, 1, '多个消费者共享同一个 Surface');

  await runtime.closeCapture(hls.id, hls.captureToken);
  assert.equal(runtime.describe().producing, true);
  await runtime.closeCapture(qq.id, qq.captureToken);
  await sleep(30);
  const stoppedPulls = provider.pulls;
  await sleep(60);
  assert.equal(runtime.describe().producing, false);
  assert.equal(provider.pulls, stoppedPulls, '最后消费者离开后帧泵必须停止');
  assert.equal(runtime.describe().surfaces.length >= 2, true, '文字声明不因停止像素而消失');

  sessions.close('desktop');
  fs.writeFileSync(file, JSON.stringify(sessions.snapshot()));
  const closed = await runtime.openCapture({ consumer: 'hls', fps: 20 });
  assert.equal(runtime.describe().producing, false);
  assert.throws(() => runtime.getCaptureFrame(closed.id, closed.captureToken), /desktop is closed/);

  sessions.restart('desktop');
  fs.writeFileSync(file, JSON.stringify(sessions.snapshot()));
  runtime.refreshSessions();
  await runtime.reconcile();
  await sleep(80);
  assert.equal(runtime.describe().producing, true);
  assert.ok(runtime.getCaptureFrame(closed.id, closed.captureToken).data.length > 0);

  const expiring = await runtime.openCapture({ consumer: 'hls', fps: 20 });
  runtime.getCapture(expiring.id).lastReadAt = Date.now() - 31000;
  assert.throws(() => runtime.getCaptureFrame(expiring.id, expiring.captureToken), /capture expired/);
  assert.equal(runtime.listCaptures().some((c) => c.id === expiring.id), false);

  runtime.close();
  console.log('ok: 无订阅不产帧；共享 Surface；排除自捕获；桌面关闭即停帧');
} finally {
  try { fs.unlinkSync(file); } catch {}
}
