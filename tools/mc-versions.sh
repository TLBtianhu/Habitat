#!/usr/bin/env bash
# 查 mineflayer 支持的版本，并找出对应服务端 jar 的下载地址
set -u
export PATH="$HOME/opt/node/bin:$PATH"
echo "=== minecraft-data 支持的 pc 版本（尾 10 个）==="
node -e "const m=require('/opt/habitat/fishbowl/bot/node_modules/minecraft-data');console.log(m.supportedVersions.pc.slice(-10).join(', '))"
echo "=== 版本清单（直连 mojang）==="
curl -sS --max-time 40 -o /tmp/manifest.json https://piston-meta.mojang.com/mc/game/version_manifest_v2.json && \
  node -e "
const j=require('/tmp/manifest.json');
const v=j.latest.release;
console.log('latest release:', v);
const e=j.versions.find(x=>x.id===v);
console.log('url:', e && e.url);
" || echo "manifest failed"
echo "=== 26.1 的服务端 jar ==="
node -e "
const j=require('/tmp/manifest.json');
const ids=['26.1','26.0','1.21.11'];
for(const id of ids){ const e=j.versions.find(x=>x.id===id); if(e){ console.log(id, e.url); } }
"
