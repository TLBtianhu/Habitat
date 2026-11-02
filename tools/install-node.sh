#!/usr/bin/env bash
# 免 root 装 Node 20 到 ~/opt/node（mineflayer 官方推荐 18/20）
set -u
V="${NODE_VER:-v20.18.1}"
DEST="$HOME/opt/node"
mkdir -p "$HOME/opt" "$HOME/.cache/dl"
cd "$HOME/.cache/dl" || exit 1

if [ -x "$DEST/bin/node" ]; then
  echo "already installed: $("$DEST/bin/node" -v)"
  exit 0
fi

URL="https://npmmirror.com/mirrors/node/$V/node-$V-linux-x64.tar.xz"
echo "=== probe mirrors ==="
for u in "$URL" "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$u" 2>/dev/null || echo FAIL)
  echo "$code  $u"
done

echo "=== download ==="
curl -fSL --max-time 300 -o node.tar.xz "$URL" || { echo "download failed"; exit 1; }
ls -lh node.tar.xz
echo "=== extract ==="
rm -rf "$HOME/opt/.node-tmp"; mkdir -p "$HOME/opt/.node-tmp"
tar -xJf node.tar.xz -C "$HOME/opt/.node-tmp" || { echo "extract failed"; exit 1; }
mv "$HOME/opt/.node-tmp/node-$V-linux-x64" "$DEST"
echo "=== version ==="
"$DEST/bin/node" -v
"$DEST/bin/npm" -v
echo "=== npm registry (国内镜像) ==="
"$DEST/bin/npm" config set registry https://registry.npmmirror.com
"$DEST/bin/npm" config get registry
