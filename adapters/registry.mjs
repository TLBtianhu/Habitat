// Adapter 注册表：每个 AI 客户端都是独立进程、独立版本、独立 manifest
import fs from 'node:fs';
import path from 'node:path';

export function loadAdapters(root = '/opt/habitat/app/adapters') {
  if (!fs.existsSync(root)) return {};
  const out = {};
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    out[m.name || name] = { ...m, dir: path.join(root, name) };
  }
  return out;
}
