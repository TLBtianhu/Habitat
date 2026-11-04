// owner 主动开启的统一预览服务：只启动 Compositor CaptureSession 与 ConsolePreviewOutput。
import { SceneRecorder } from './scene-recorder.mjs';
import { CaptureClient } from './capture-client.mjs';
import { ConsolePreviewOutput } from './outputs/console-preview.mjs';

export class ScenePreviewService {
  constructor({ desktopUrl, agentToken, ownerToken, fps = 5, host = '127.0.0.1', port = 9281 }) {
    this.preview = new ConsolePreviewOutput({ token: ownerToken, host, port });
    this.recorder = new SceneRecorder({
      capture: new CaptureClient({ desktopUrl, token: agentToken, fps }),
      outputs: { console: this.preview },
      fps,
    });
  }

  status() {
    return { ...this.recorder.status(), preview: this.preview.status() };
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

  async stopAll() {
    return this.recorder.stop();
  }
}
