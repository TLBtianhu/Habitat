// SceneRecorder 的 CaptureClient：只订阅 Compositor，不负责渲染、编码或平台输出。
export class CaptureClient {
  constructor({ desktopUrl, token, fetchImpl = fetch, source = { kind: 'display', id: 'main' }, excludeSurfaces = ['live'], instanceId = null, fps = 5 }) {
    if (!desktopUrl) throw new Error('desktopUrl required');
    this.desktopUrl = desktopUrl.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
    this.source = source;
    this.excludeSurfaces = excludeSurfaces;
    this.instanceId = instanceId;
    this.fps = fps;
    this.id = null;
    this.captureToken = null;
    this.latestSeq = 0;
  }

  async open() {
    if (this.id) return this.id;
    const response = await this.fetch(`${this.desktopUrl}/capture/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ schemaVersion: 1, consumer: 'scene-recorder', consumerApp: 'live', source: this.source, excludeSurfaces: this.excludeSurfaces, instanceId: this.instanceId, fps: this.fps }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `capture open HTTP ${response.status}`);
    this.id = data.id;
    this.captureToken = data.captureToken;
    this.latestSeq = 0;
    return this.id;
  }

  async close() {
    const id = this.id;
    this.id = null;
    this.captureToken = null;
    if (!id) return;
    try {
      await this.fetch(`${this.desktopUrl}/capture/close`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {}
  }

  async poll() {
    if (!this.id) await this.open();
    const response = await this.fetch(`${this.desktopUrl}/capture/frame?id=${encodeURIComponent(this.id)}`, {
      cache: 'no-store', headers: { authorization: `Bearer ${this.captureToken}` }, signal: AbortSignal.timeout(4000),
    });
    if (response.status === 202 || response.status === 409) return null;
    if ([403, 404, 410].includes(response.status)) {
      this.id = null;
      this.captureToken = null;
      return null;
    }
    if (!response.ok) throw new Error(`capture frame HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    const seq = Number(response.headers.get('x-frame-seq') || this.latestSeq + 1);
    if (seq <= this.latestSeq) return null;
    this.latestSeq = seq;
    return {
      seq,
      capturedAt: Number(response.headers.get('x-frame-at') || Date.now()),
      width: Number(response.headers.get('x-frame-width') || 0) || null,
      height: Number(response.headers.get('x-frame-height') || 0) || null,
      format: 'png',
      data,
    };
  }
}
