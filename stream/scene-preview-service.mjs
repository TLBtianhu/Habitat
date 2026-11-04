// owner 主动开启的统一预览服务：只启动 Compositor CaptureSession 与 ConsolePreviewOutput。
import { SceneRecorder } from './scene-recorder.mjs';
import { CaptureClient } from './capture-client.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { readLiveConfig, validateLiveConfig, buildBilibiliTarget } from './bilibili-live-config.mjs';
import { PlaybackVerifier } from './playback-verifier.mjs';

export class ScenePreviewService {
  constructor({ desktopUrl, agentToken, ownerToken, fps = 5, host = '127.0.0.1', port = 9281, bilibiliConfigPath = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/opt/habitat/config/bilibili-live.json', bilibiliFactory = null, verifier = null }) {
    this.preview = new ConsolePreviewOutput({ token: ownerToken, host, port });
    this.bilibiliConfigPath = bilibiliConfigPath;
    this.bilibiliFactory = bilibiliFactory;
    this.bilibili = null;
    this.verifier = verifier || new PlaybackVerifier({
      configPath: bilibiliConfigPath,
      outputStatus: () => this.bilibili?.status() || { state: 'stopped' },
    });
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
      verification: this.verifier.status(),
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
    if (this.bilibili?.status().state === 'running') {
      this.verifier.start();
      return this.status();
    }
    const config = validateLiveConfig(readLiveConfig(this.bilibiliConfigPath));
    if (!config.rtmpUrl || !config.streamKey) throw new Error('Bilibili live config incomplete');
    const target = buildBilibiliTarget(config.rtmpUrl, config.streamKey);
    if (this.bilibili && this.bilibili.target !== target) {
      await this.bilibili.stop();
      this.bilibili = null;
    }
    if (!this.bilibili) {
      this.bilibili = this.bilibiliFactory ? this.bilibiliFactory(config) : new BilibiliRtmpOutput({ target: config.rtmpUrl, streamKey: config.streamKey });
      this.recorder.outputs.set('bilibili', this.bilibili);
    }
    await this.recorder.startOutput('bilibili');
    this.verifier.start();
    return this.status();
  }

  verifyBilibili() {
    return this.verifier.verifyNow();
  }

  verificationStatus() {
    return this.verifier.status();
  }

  async stopBilibili() {
    this.verifier.stop();
    if (this.bilibili) await this.recorder.stopOutput('bilibili');
    if (![...this.recorder.outputs.values()].some((output) => output.status?.().state === 'running')) {
      await this.recorder.stop();
    }
    return this.status();
  }

  async stopAll() {
    this.verifier.stop();
    return this.recorder.stop();
  }
}
