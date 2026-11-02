#!/usr/bin/env bash
# 10: 严格离线构建 —— 清 build 且禁用 build cache，证明依赖缓存本身足够
set -uo pipefail
DST="$HOME/work/tutorialmod"
cd "$DST"

export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

rm -rf build
START=$(date +%s)
./gradlew build --offline --no-build-cache --console=plain 2>&1 | tail -25
RC=${PIPESTATUS[0]}
END=$(date +%s)
echo "### STRICT_OFFLINE_EXIT=$RC  SECONDS=$((END-START)) ###"
ls -la build/libs/ 2>/dev/null || echo "(no build/libs)"
