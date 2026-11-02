// 开发路径依赖审计：安装环境不应出现这些硬编码
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Habitat';
const INCLUDE = ['tools', 'runtime', 'agent', 'display', 'identity', 'bot', 'bot-host', 'director', 'stage'];
const NEEDLES = ['C:/Habitat', 'C:\\deepseek直播', '/opt/habitat/src'];
const hits = [];

function walk(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(p)) walk(path.join(rel, n));
    return;
  }
  if (!/\.(mjs|js|sh|ps1|html)$/.test(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const needle of NEEDLES) {
    const count = text.split(needle).length - 1;
    if (count) hits.push({ file: rel, needle, count });
  }
}
for (const d of INCLUDE) walk(d);

console.log('硬编码开发路径命中:', hits.length);
for (const h of hits.slice(0, 80)) console.log(`  ${h.file}  ${h.needle} ×${h.count}`);
process.exit(hits.length ? 1 : 0);
