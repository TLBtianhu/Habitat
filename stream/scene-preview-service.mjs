// owner 主动开启的统一预览服务：只启动 Compositor CaptureSession 与 ConsolePreviewOutput。
import { SceneRecorder } from './scene-recorder.mjs';
import { CaptureClient } from './capture-client.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { readLiveConfig, validateLiveConfig } from './bilibili-live-config.mjs';

export class ScenePreviewService {
  constructor({ desktopUrl, agentToken, ownerToken, fps = 5, host = '127.0.0.1', port = 9281, bilibiliConfigPath = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/opt/habitat/config/bilibili-live.json', bilibiliFactory = null }) {
    this.preview = new ConsolePreviewOutput({ token: ownerToken, host, port });
    this.bilibiliConfigPath = bilibiliConfigPath;
    this.bilibiliFactory = bilibiliFactory;
    this.bilibili = null;
    this.recorder = new SceneRecorder({
      capture: new CaptureClient({ desktopUrl, token: agentToken, fps }),
      outputs: { console: this.preview },
      fps,
    });
  }

  status() {
    return {
      ...this.recorder.status(),
      preview: this.preview.status(),
      bilibili: this.bilibili?.status() || { state: 'stopped', verifiedAt: null, lastError: null },
    };
  }

  async start() {
    await this.recorder.startOutput('console');
    return this.status();
  }

  async stop() {
    await this.recorder.stopOutput('console');
    if (![...this.recorder.outputs.values()].some((output) => output.status?.().state === 'running')) {
      await this.recorder.stop();
    }
    return this.status();
  }

  async startBilibili() {
    if (this.bilibili?.status().state === 'running') return this.status();
    const config = validateLiveConfig(readLiveConfig(this.bilibiliConfigPath));
    if (!config.rtmpUrl || !config.streamKey) throw new Error('Bilibili live config incomplete');
    const target = /^rtmps?:\/\//.test(config.rtmpUrl) ? `${config.rtmpUrl.replace(/\/$/, '')}/${config.streamKey}` : config.rtmpUrl;
    if (this.bilibili && this.bilibili.target !== target) {
      await this.bilibili.stop();
      this.bilibili = null;
    }
    if (!this.bilibili) {
      this.bilibili = this.bilibiliFactory ? this.bilibiliFactory(config) : new BilibiliRtmpOutput({ target: config.rtmpUrl, streamKey: config.streamKey });
      this.recorder.outputs.set('bilibili', this.bilibili);
    }
    await this.recorder.startOutput('bilibili');
    return this.status();
  }

  async stopBilibili() {
    if (this.bilibili) await this.recorder.stopOutput('bilibili');
    if (![...this.recorder.outputs.values()].some((output) => output.status?.().state === 'running')) {
      await this.recorder.stop();
    }
    return this.status();
  }

  async stopAll() {
    return this.recorder.stop();
  }
}
