// Kokoro 82M + sherpa-onnx：现代神经 TTS，CPU 本地推理，不依赖 PyTorch。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let sequence = 0;
export class KokoroBackend {
  constructor(profile, { outputDir = null, spawnImpl = spawn } = {}) {
    this.profile = profile;
    this.outputDir = outputDir;
    this.spawn = spawnImpl;
  }

  probe() {
    const p = this.profile;
    const required = ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt'];
    const missing = required.filter((name) => !fs.existsSync(path.join(p.modelDir, name)));
    if (!fs.existsSync(p.binary)) missing.push(p.binary);
    const outputDir = this.outputDir || process.env.HABITAT_TMP_ROOT || path.join(process.env.HABITAT_INSTANCE_ROOT || '/opt/habitat', 'tmp');
    try {
      fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
      fs.accessSync(outputDir, fs.constants.W_OK);
    } catch {
      missing.push(`output-not-writable:${outputDir}`);
    }
    return {
      available: missing.length === 0,
      engine: 'sherpa-onnx',
      architecture: 'Kokoro-82M neural TTS',
      speaker: p.speaker,
      missing,
    };
  }

  async synthesize(text) {
    const p = this.profile;
    const dir = p.modelDir;
    const outputDir = this.outputDir || process.env.HABITAT_TMP_ROOT || path.join(process.env.HABITAT_INSTANCE_ROOT || '/opt/habitat', 'tmp');
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const output = path.join(outputDir, `habitat-kokoro-${process.pid}-${++sequence}.wav`);
    const args = [
      '--debug=0',
      `--kokoro-model=${path.join(dir, 'model.onnx')}`,
      `--kokoro-voices=${path.join(dir, 'voices.bin')}`,
      `--kokoro-tokens=${path.join(dir, 'tokens.txt')}`,
      `--kokoro-lexicon=${path.join(dir, 'lexicon-us-en.txt')},${path.join(dir, 'lexicon-zh.txt')}`,
      `--tts-rule-fsts=${path.join(dir, 'date-zh.fst')},${path.join(dir, 'phone-zh.fst')},${path.join(dir, 'number-zh.fst')}`,
      `--num-threads=${p.threads || 4}`,
      `--sid=${p.speakerId}`,
      `--output-filename=${output}`,
      text,
    ];
    return new Promise((resolve, reject) => {
      const child = this.spawn(p.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const errors = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('kokoro synthesis timeout'));
      }, 120000);
      child.stderr.on('data', (chunk) => errors.push(chunk));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`kokoro exited ${code}: ${Buffer.concat(errors).toString().slice(0, 500)}`));
          return;
        }
        try { resolve(fs.readFileSync(output)); }
        catch (e) { reject(e); }
        finally { fs.rmSync(output, { force: true }); }
      });
    });
  }
}
