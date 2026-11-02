#!/usr/bin/env bash
# 换成 Node 22（mineflayer 4.39 要求 >=22）
set -u
V="${NODE_VER:-v22.18.0}"
DEST="$HOME/opt/node"
cd "$HOME/.cache/dl" || exit 1

if [ -x "$DEST/bin/node" ] && "$DEST/bin/node" -v | grep -q '^v22'; then
  echo "already v22: $("$DEST/bin/node" -v)"; exit 0
fi

echo "=== download $V ==="
curl -fSL --max-time 300 -o node22.tar.xz "https://npmmirror.com/mirrors/node/$V/node-$V-linux-x64.tar.xz" || exit 1
rm -rf "$HOME/opt/.node22"; mkdir -p "$HOME/opt/.node22"
tar -xJf node22.tar.xz -C "$HOME/opt/.node22" || exit 1
rm -rf "$DEST.old"
[ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$HOME/opt/.node22/node-$V-linux-x64" "$DEST"
export PATH="$DEST/bin:$PATH"
echo "=== version ==="
node -v; npm -v
