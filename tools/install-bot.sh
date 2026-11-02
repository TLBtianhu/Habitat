#!/usr/bin/env bash
# 用刚装的 Node 装 mineflayer + prismarine-viewer
set -u
export PATH="$HOME/opt/node/bin:$PATH"
export npm_config_registry="https://registry.npmmirror.com"

echo "=== versions ==="
node -v; npm -v
echo "=== 工作目录 ==="
mkdir -p "$HOME/fishbowl/bot"
cd "$HOME/fishbowl/bot" || exit 1
[ -f package.json ] || npm init -y >/dev/null 2>&1
echo "=== install (mineflayer + prismarine-viewer) ==="
npm install --no-audit --no-fund mineflayer prismarine-viewer 2>&1 | tail -12
echo "=== 结果 ==="
node -e "const p=require('mineflayer/package.json');const v=require('prismarine-viewer/package.json');console.log('mineflayer',p.version,'| prismarine-viewer',v.version)"
du -sh node_modules 2>/dev/null
