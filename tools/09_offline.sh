#!/usr/bin/env bash
# 09: 清空 build 后离线构建验证
set -uo pipefail
DST="$HOME/work/tutorialmod"
cd "$DST"

export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

echo "=== 清理 build/ 目录 ==="
rm -rf build
ls -la | grep -E 'build|src' || true

LOG="$HOME/work/build-offline.log"
START=$(date +%s)
echo "### START $(date -Is) -- ./gradlew build --offline ###"
./gradlew build --offline --console=plain 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
END=$(date +%s)
echo "### OFFLINE_EXIT=$RC  OFFLINE_SECONDS=$((END-START)) ###"
echo "=== artifacts ==="
ls -la build/libs/ 2>/dev/null || echo "(no build/libs)"
echo "=== artifact detail ==="
stat -c '%n %s bytes' build/libs/*.jar 2>/dev/null
echo "=== jar content head ==="
"$JAVA_HOME/bin/jar" tf build/libs/tutorialmod-1.0.0.jar 2>/dev/null | head -15
echo "=== ~/.gradle size ==="
du -sh "$HOME/.gradle"
