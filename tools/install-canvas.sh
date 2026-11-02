#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
cd "$HOME/fishbowl/bot" || exit 1
echo "=== install canvas（用 npmmirror 的二进制镜像）==="
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com \
  --canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas canvas 2>&1 | tail -8
echo "=== 验证 ==="
node -e "const c=require('canvas');console.log('canvas ok', c.createCanvas(10,10).toDataURL().slice(0,20))" 2>&1 | head -5
