// 公开快照审计：禁止秘密、个人账号、开发路径、运行数据和第三方资产进入发布仓库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  ['a11e9f', '83618f4451a79533ef02db51d4'].join(''),
  ['c2bf3d', 'b1b880'].join(''),
  ['30680', '15617'].join(''),
  ['364684', '0573'].join(''),
  ['399795', '1865'].join(''),
  ['109859', '1186'].join(''),
  '/home/' + 'tlb3',
  'C:\\Users\\30680',
];
const required = ['LICENSE', 'NOTICE.md', 'README.md', '.gitignore', 'package.json', 'package-lock.json', 'docs/distribution/forms.md', 'docs/distribution/runtime-policy.md', 'docs/distribution/plugin-ecosystem.md'];
for (const rel of required) {
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error('缺少公开快照文件: ' + rel);
}
for (const rel of ['dist', 'artifacts', 'node_modules', 'assets-packs', 'bot', 'bot-host', 'display', 'voice/runtime/python', 'voice/models', 'stage/diagnostics.json']) {
  if (fs.existsSync(path.join(ROOT, rel))) throw new Error('公开快照含排除目录: ' + rel);
}
let count = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) { walk(file); continue; }
    if (!/\.(?:mjs|js|json|md|sh|ps1|ya?ml|txt)$/i.test(name) || stat.size > 2 * 1024 * 1024) continue;
    count++;
    const text = fs.readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) throw new Error(`公开快照含敏感内容 ${needle}: ${file}`);
    }
  }
})(ROOT);
console.log(`ok: 公开快照 ${count} 个文本文件通过秘密/账号/开发路径/资产审计`);
