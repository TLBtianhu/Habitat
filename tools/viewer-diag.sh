#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
echo "=== viewer 根路由响应 ==="
curl -s -i --max-time 8 http://127.0.0.1:3007/ | head -20
echo
echo "=== viewer 支持的版本 ==="
cd "$HOME/fishbowl/bot" || exit 1
node -e "const v=require('prismarine-viewer/viewer/lib/version').supportedVersions; console.log(Object.keys(v).slice(-8).join(', '))" 2>&1 | head -3
echo "=== 是否有 index.html 资源 ==="
ls node_modules/prismarine-viewer/viewer | head
