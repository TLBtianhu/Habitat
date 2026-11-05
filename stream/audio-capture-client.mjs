// 本地 Audio Mixer 捕获客户端：只读取 Voice PCM，不打开麦克风，不接触公网凭证。
export class AudioCaptureClient {
  constructor({ baseUrl = process.env.HABITAT_AUDIO_URL || 'http://127.0.0.1:9271', fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    const url = new URL(this.baseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('audio capture must use loopback');
    this.fetch = fetchImpl;
  }

  async request(path, body) {
    const response = await this.fetch(this.baseUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `audio capture HTTP ${response.status}`);
    return data;
  }

  async open({ instanceId = null } = {}) {
    const session = await this.request('/capture/open', { consumer: 'bilibili-rtmp', instanceId });
    if (!session.id || session.format?.codec !== 's16le' || session.format?.rate !== 48000 || session.format?.channels !== 2) {
      if (session.id) await this.close(session.id).catch(() => {});
      throw new Error('unsupported audio capture format');
    }
    return {
      id: session.id,
      url: `${this.baseUrl}/capture/pcm?id=${encodeURIComponent(session.id)}`,
      close: () => this.close(session.id),
    };
  }

  async close(id) {
    return this.request('/capture/close', { id });
  }
}
