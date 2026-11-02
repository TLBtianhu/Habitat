#!/usr/bin/env bash
# 启动/重启 MC bot
set -u
export PATH="$HOME/opt/node/bin:$PATH"
DIR="$HOME/fishbowl/bot"
mkdir -p "$DIR"
cp "/opt/habitat/src/bot/run.js" "$DIR/run.js"
cd "$DIR" || exit 1

pkill -f 'fishbowl/bot/run.js' 2>/dev/null
sleep 1
nohup node run.js > bot.log 2>&1 &
echo "bot pid $!"
sleep 12
echo "=== bot.log ==="
tail -25 bot.log
echo "=== 监听 ==="
ss -lnt 2>/dev/null | grep -E '3007|25565' || echo "no ports"
