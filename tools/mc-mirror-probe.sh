#!/usr/bin/env bash
# 探测能拿到 MC 26.1 服务端 jar 的镜像
set -u
export PATH="$HOME/opt/node/bin:$PATH"
URLS=(
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
  "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
  "https://bmclapi2.bangbang93.com/version/26.1/server"
  "https://download.mcim.qq.com/"
)
for u in "${URLS[@]}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$u" 2>/dev/null || echo FAIL)
  echo "$code  $u"
done
echo "=== 用 bmclapi 拿 26.1 的 version json ==="
curl -sS --max-time 30 -o /tmp/v26.json "https://bmclapi2.bangbang93.com/version/26.1/json" 2>/dev/null && \
  head -c 300 /tmp/v26.json && echo ""
