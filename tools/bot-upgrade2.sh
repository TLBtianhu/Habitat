#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
cd "$HOME/fishbowl/bot" || exit 1
echo "=== 强制装指定版本（npmmirror）==="
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com \
  mineflayer@4.39.0 minecraft-protocol@1.68.0 prismarine-viewer@1.33.0 2>&1 | tail -6
echo "=== 版本 ==="
node -e "console.log('mineflayer', require('mineflayer/package.json').version, '| protocol', require('minecraft-protocol/package.json').version, '| data', require('minecraft-data/package.json').version)"
echo "=== loader 支持到哪 ==="
node -e "
const loader=require('mineflayer/lib/loader.js');
console.log('supportedVersions tail:', require('minecraft-data').supportedVersions.pc.slice(-5).join(','));
" 2>&1
