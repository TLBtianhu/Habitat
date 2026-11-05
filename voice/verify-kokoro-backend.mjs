import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KokoroBackend } from './backends/kokoro.mjs';

const root = path.join(process.cwd(), '.tmp', `kokoro-backend-${process.pid}`);
const modelDir = path.join(root, 'model');
const outputDir = path.join(root, 'output');
fs.mkdirSync(modelDir, { recursive: true });
const binary = path.join(root, 'sherpa-onnx-offline-tts');
for (const name of ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) fs.writeFileSync(path.join(modelDir, name), 'test');
fs.writeFileSync(binary, 'test');
const profile = { modelDir, binary, speakerId: 0 };
try {
  const backend = new KokoroBackend(profile, { outputDir });
  const healthy = backend.probe();
  assert.equal(healthy.available, true);
  assert.ok(fs.existsSync(outputDir));
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const blocked = path.join(root, 'blocked');
    fs.mkdirSync(blocked, { mode: 0o500 });
    const denied = new KokoroBackend(profile, { outputDir: blocked }).probe();
    assert.equal(denied.available, false);
    assert.ok(denied.missing.some((item) => item.startsWith('output-not-writable:')), '可写输出目录必须属于健康探测');
    fs.chmodSync(blocked, 0o700);
  }
  console.log('ok: Kokoro 模型与可写输出目录健康探测');
} finally {
  try { fs.chmodSync(path.join(root, 'blocked'), 0o700); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
