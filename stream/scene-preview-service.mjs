// owner 主动开启的统一预览服务：只启动 Compositor CaptureSession 与 ConsolePreviewOutput。
import { SceneRecorder } from './scene-recorder.mjs';
import { CaptureClient } from './capture-client.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';
import { readLiveConfig, validateLiveConfig, buildBilibiliTarget } from './bilibili-live-config.mjs';
import { PlaybackVerifier } from './playback-verifier.mjs';
import { RtmpNetworkPolicy } from './network-policy.mjs';
import { AudioCaptureClient } from './audio-capture-client.mjs';
import { probePlaybackTiming } from './playback-timing.mjs';

export class ScenePreviewService {
  constructor({ desktopUrl, agentToken, ownerToken, fps = 5, host = '127.0.0.1', port = 9281, bilibiliConfigPath = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/opt/habitat/config/bilibili-live.json', bilibiliFactory = null, verifier = null, network = null, bilibiliAudio = process.env.HABITAT_BILIBILI_AUDIO || 'none', audioCapture = null, requireAudio = process.env.HABITAT_PLAYBACK_REQUIRE_AUDIO === '1' }) {
    this.preview = new ConsolePreviewOutput({ token: ownerToken, host, port });
    this.bilibiliConfigPath = bilibiliConfigPath;
    this.bilibiliFactory = bilibiliFactory;
    this.bilibiliAudio = bilibiliAudio;
    this.audioCapture = audioCapture || new AudioCaptureClient();
    this.bilibili = null;
    this.network = network || new RtmpNetworkPolicy();
    this.verifier = verifier || new PlaybackVerifier({
      configPath: bilibiliConfigPath,
      outputStatus: () => this.bilibili?.status() || { state: 'stopped' },
      dispatcherFactory: () => this.network.apiDispatcher(),
      requireAudio,
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
      network: this.network.status(),
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
      const options = { ...config, network: this.network, audio: this.bilibiliAudio, audioCapture: this.audioCapture };
      this.bilibili = this.bilibiliFactory ? this.bilibiliFactory(options) : new BilibiliRtmpOutput({ target: options.rtmpUrl, streamKey: options.streamKey, network: options.network, audio: options.audio, audioCapture: options.audioCapture, rateControl: process.env.HABITAT_BILIBILI_RATE_CONTROL || 'vbv' });
      this.recorder.outputs.set('bilibili', this.bilibili);
    }
    await this.recorder.startOutput('bilibili');
    this.verifier.start();
    return this.status();
  }

  saveNetwork(body) {
    if (['starting', 'running', 'stopping', 'reconnecting'].includes(this.bilibili?.status().state)) throw new Error('stop the live output before changing network');
    return this.network.save(body);
  }

  checkNetwork() {
    const config = validateLiveConfig(readLiveConfig(this.bilibiliConfigPath));
    return this.network.check(config.rtmpUrl);
  }

  verifyBilibili() {
    return this.verifier.verifyNow();
  }

  verificationStatus() {
    return this.verifier.status();
  }

  async timingBilibili() {
    if (this.bilibili?.status().state !== 'running') throw new Error('start the live output before timing verification');
    const config = readLiveConfig(this.bilibiliConfigPath);
    const uid = config.streamKey.match(/streamname=live_(\d+)_/)?.[1];
    if (!uid) throw new Error('cannot resolve Bilibili uid');
    const room = await this.verifier.fetchJson(`https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=${uid}`);
    if (!room.roomid) throw new Error('cannot resolve Bilibili room');
    const play = await this.verifier.fetchJson(`https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${room.roomid}&quality=0&platform=web`);
    const playbackUrl = play.durl?.[0]?.url;
    if (!playbackUrl) throw new Error('no playable stream for timing verification');
    return probePlaybackTiming(playbackUrl, { requireAudio: this.verifier.requireAudio, expectAudio: this.bilibiliAudio === 'mixer', captureFile: '/opt/habitat/data/artifacts/playback-timing-sample.flv' });
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
