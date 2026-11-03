import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'win');
const lines = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
for (const line of lines) {
  const [expected, rel] = line.split(/\s{2,}/);
  const file = path.join(root, rel);
  const bytes = fs.readFileSync(file);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error('Windows artifact hash mismatch: ' + rel);
  if (rel.endsWith('.exe') && bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('invalid EXE: ' + rel);
}
console.log(`ok: ${lines.length} 个 Windows 安装产物通过 MZ/SHA256 校验`);
