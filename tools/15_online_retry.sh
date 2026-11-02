#!/usr/bin/env bash
# 15: 复现在线构建；若 piston-meta 走代理不稳，则改用 nonProxyHosts 走直连
set -uo pipefail
cd "$HOME/work/tutorialmod"
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

echo "=== 探针: piston-meta 经代理 x3 ==="
for i in 1 2 3; do
  printf 'try%d: ' "$i"
  curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 15 -x http://127.0.0.1:7897 \
    https://piston-meta.mojang.com/mc/game/version_manifest.json || echo FAIL
done

echo
echo "########## 在线构建重试 (attempt 1: 纯代理) ##########"
S=$(date +%s)
./gradlew build --console=plain 2>&1 | grep -vE 'WARNING:|^Note:|warning: \[' | tail -8
RC=${PIPESTATUS[0]}
echo "### ONLINE_RETRY1_EXIT=$RC  SECONDS=$(( $(date +%s) - S )) ###"

if [ "$RC" -ne 0 ]; then
  echo
  echo "########## 在线构建重试 (attempt 2: mojang 直连 + 其余走代理) ##########"
  cp gradle.properties gradle.properties.bak
  grep -q 'nonProxyHosts' gradle.properties || cat >> gradle.properties <<'EOF'
# mojang 的 piston-meta 走代理不稳（会 TLS 重置），但对它直连很快，所以绕过代理
systemProp.http.nonProxyHosts=piston-meta.mojang.com|*.mojang.com|localhost|127.0.0.1
EOF
  S=$(date +%s)
  ./gradlew build --console=plain 2>&1 | grep -vE 'WARNING:|^Note:|warning: \[' | tail -8
  RC2=${PIPESTATUS[0]}
  echo "### ONLINE_RETRY2_EXIT=$RC2  SECONDS=$(( $(date +%s) - S )) ###"
fi
echo "=== jar ==="; stat -c '%n | %s bytes | %y' build/libs/*.jar 2>/dev/null || echo "(no jar)"
echo "=== gradle.properties 代理段 ==="; grep -n 'proxy' gradle.properties
