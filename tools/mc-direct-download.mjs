// 最小原生 MC 启动器：不依赖 HeadlessMc 的 Java 管理，直接用本地 JDK 21
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Habitat/artifacts/mc-native';
const WSL_ROOT = '/opt/habitat/app/mc-native';
const VERSION = '1.21.4';
const versionJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions', VERSION, VERSION + '.json'), 'utf8'));

function allowed(lib) {
  if (!lib.rules) return true;
  let ok = false;
  for (const r of lib.rules) {
    if (r.action === 'allow') ok = true;
    if (r.action === 'disallow') return false;
  }
  return ok;
}

function artifacts(json) {
  const out = [];
  for (const lib of json.libraries || []) {
    if (!allowed(lib)) continue;
    if (lib.downloads?.artifact) out.push({ path: lib.downloads.artifact.path, url: lib.downloads.artifact.url });
    const natives = lib.natives?.linux;
    if (natives && lib.downloads?.classifiers?.[natives]) {
      const c = lib.downloads.classifiers[natives];
      out.push({ path: c.path, url: c.url, native: true });
    }
  }
  return out;
}

const base = artifacts(versionJson);
const fabricJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions', 'fabric-loader-0.20.1-1.21.4', 'fabric-loader-0.20.1-1.21.4.json'), 'utf8'));
const fabric = artifacts(fabricJson);
const all = [...base, ...fabric];
console.log('library artifacts:', all.length);

const libDir = path.join(ROOT, 'libraries');
fs.mkdirSync(libDir, { recursive: true });
for (const a of all) {
  const dest = path.join(libDir, a.path);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('download', a.path);
  execFileSync('curl.exe', ['-sSL', '--ssl-no-revoke', '--max-time', '120', a.url, '-o', dest], { stdio: 'inherit' });
}

// 资源索引
const assetIndexUrl = versionJson.assetIndex.url;
const assetDir = path.join(ROOT, 'assets');
fs.mkdirSync(assetDir, { recursive: true });
const idxPath = path.join(assetDir, 'indexes', versionJson.assetIndex.id + '.json');
fs.mkdirSync(path.dirname(idxPath), { recursive: true });
if (!fs.existsSync(idxPath)) execFileSync('curl.exe', ['-sSL', '--ssl-no-revoke', assetIndexUrl, '-o', idxPath], { stdio: 'inherit' });
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
const entries = Object.entries(idx.objects || {});
console.log('asset objects:', entries.length);
let i = 0;
for (const [name, obj] of entries) {
  const hash = obj.hash;
  const dest = path.join(assetDir, 'objects', hash.slice(0, 2), hash);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
  execFileSync('curl.exe', ['-sSL', '--ssl-no-revoke', '--max-time', '60', url, '-o', dest], { stdio: 'ignore' });
  if (++i % 200 === 0) console.log('assets', i, '/', entries.length);
}

console.log('done. 下一步用 JDK 21 启动。');
