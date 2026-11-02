// 轻量本地 TTS 后端：仅做文字→WAV，不涉及 LLM 或大肥鱼人格。
import { spawn, spawnSync } from 'node:child_process';

export class EspeakBackend {
  constructor(profile) {
    this.profile = profile;
  }

  static probe() {
    const r = spawnSync('espeak-ng', ['--version'], { encoding: 'utf8' });
    return { available: r.status === 0, version: (r.stdout || r.stderr || '').trim().split(/\r?\n/)[0] || null };
  }

  async synthesize(text) {
    return new Promise((resolve, reject) => {
      const child = spawn('espeak-ng', [
        '--stdin', '--stdout', '-v', this.profile.voice || 'cmn', '-s', String(this.profile.rate || 165),
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      const output = [];
      const errors = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('espeak-ng synthesis timeout'));
      }, 30000);
      child.stdout.on('data', (chunk) => output.push(chunk));
      child.stderr.on('data', (chunk) => errors.push(chunk));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(output));
        else reject(new Error(`espeak-ng exited ${code}: ${Buffer.concat(errors).toString().slice(0, 300)}`));
      });
      child.stdin.end(text);
    });
  }
}
