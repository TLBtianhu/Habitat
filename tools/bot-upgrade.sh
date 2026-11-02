#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
cd "$HOME/fishbowl/bot" || exit 1

echo "=== 当前版本 ==="
node -e "console.log('mineflayer', require('mineflayer/package.json').version, '| minecraft-protocol', require('minecraft-protocol/package.json').version)"

echo "=== registry 探测 ==="
for r in https://registry.npmjs.org https://registry.npmmirror.com; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$r/mineflayer" 2>/dev/null || echo FAIL)
  echo "$code  $r"
done

echo "=== 升级到 latest ==="
npm install --no-audit --no-fund --registry=https://registry.npmjs.org \
  mineflayer@latest minecraft-protocol@latest prismarine-viewer@latest 2>&1 | tail -8

echo "=== 升级后 ==="
node -e "console.log('mineflayer', require('mineflayer/package.json').version, '| minecraft-protocol', require('minecraft-protocol/package.json').version, '| minecraft-data', require('minecraft-data/package.json').version)"
