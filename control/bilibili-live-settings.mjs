// B 站推流设置：保存与生效状态分离，streamKey 永不回显。
import fs from 'node:fs';
import { publicLiveConfig, readLiveConfig, writeLiveConfig } from '../stream/bilibili-live-config.mjs';

export class BilibiliLiveSettings {
  constructor({ file = process.env.HABITAT_BILIBILI_LIVE_CONFIG || '/opt/habitat/config/bilibili-live.json', scenePreview }) {
    this.file = file;
    this.scenePreview = scenePreview;
  }

  get() {
    const config = readLiveConfig(this.file);
    const output = this.scenePreview.status().bilibili || { state: 'stopped', verifiedAt: null, lastError: null };
    const verification = this.scenePreview.status().verification || { state: 'stopped', verified: false, lastCheckedAt: null, lastVerifiedAt: null, lastError: null };
    const configured = Boolean(config.rtmpUrl && config.streamKey);
    const state = !configured ? 'unconfigured'
      : output.state === 'failed' || output.state === 'degraded' || verification.state === 'degraded' ? 'degraded'
        : output.state === 'reconnecting' ? 'reconnecting'
        : verification.state === 'stale' ? 'stale'
          : verification.state === 'checking' ? 'checking'
            : verification.verified ? 'verified'
              : output.state === 'starting' ? 'starting'
                : output.state === 'running' ? 'applied'
                  : output.state === 'stopped' ? 'stopped' : 'configured';
    return {
      ...publicLiveConfig(config),
      configured,
      applied: output.state === 'running',
      verified: Boolean(verification.verified),
      state,
      lastCheckedAt: verification.lastCheckedAt || (fs.existsSync(this.file) ? fs.statSync(this.file).mtimeMs : null),
      lastVerifiedAt: verification.lastVerifiedAt || output.verifiedAt || null,
      lastError: verification.lastError || output.lastError || null,
      output,
      verification,
    };
  }

  save(body) {
    if (['starting', 'running', 'stopping', 'reconnecting'].includes(this.scenePreview.status().bilibili?.state)) throw new Error('stop the live output before changing config');
    const current = readLiveConfig(this.file);
    const suppliedKey = String(body.streamKey || '').trim();
    const next = {
      rtmpUrl: String(body.rtmpUrl || '').trim(),
      streamKey: suppliedKey || current.streamKey,
    };
    if (!next.rtmpUrl) next.streamKey = '';
    writeLiveConfig(this.file, next);
    return this.get();
  }
}
