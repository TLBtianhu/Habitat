#!/usr/bin/env bash
set -u
cd "$HOME/fishbowl/bot/node_modules/prismarine-viewer" || exit 1
echo "=== lib/mineflayer.js 头部 ==="
head -40 lib/mineflayer.js
echo "=== index.js ==="
head -30 index.js
echo "=== viewer/index.js 头部 ==="
head -25 viewer/index.js 2>/dev/null || true
