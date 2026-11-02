// SurfaceProvider：文字声明始终存在；只有 Desktop attach 后才允许拉取像素。
import fs from 'node:fs';

export class FileSurfaceProvider {
  constructor({ appId = 'mc', kind = appId, framePath, view = { kind: 'firstPerson' }, maxAgeMs = 3000 }) {
    if (!framePath) throw new Error('framePath required');
    this.appId = appId;
    this.kind = kind;
    this.framePath = framePath;
    this.view = view;
    this.maxAgeMs = maxAgeMs;
    this.lastFrameAt = null;
    this.frameFresh = false;
    this.attached = false;
    this.pullCount = 0;
  }

  attachSurface() {
    this.attached = true;
    return { appId: this.appId };
  }

  detachSurface() {
    this.attached = false;
  }

  async pullFrame() {
    if (!this.attached) throw new Error(`surface not attached: ${this.appId}`);
    this.pullCount += 1;
    let fresh = false;
    let mtime = null;
    try {
      const stat = await fs.promises.stat(this.framePath);
      mtime = stat.mtime.toISOString();
      fresh = stat.isFile() && Date.now() - stat.mtimeMs <= this.maxAgeMs;
    } catch {}
    this.lastFrameAt = mtime;
    this.frameFresh = fresh;
    // 只返回仍在更新的帧引用；旧截图不得冒充当前画面。
    return {
      kind: this.kind,
      view: this.view,
      snapshot: fresh ? { frame: { path: this.framePath } } : null,
    };
  }

  describe() {
    return {
      appId: this.appId,
      attached: this.attached,
      pullCount: this.pullCount,
      frameAvailable: fs.existsSync(this.framePath),
      frameFresh: this.frameFresh,
      lastFrameAt: this.lastFrameAt,
    };
  }
}
