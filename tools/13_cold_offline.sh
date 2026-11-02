#!/usr/bin/env bash
# 13: 彻底冷启动的离线构建：删 build/ 与项目 .gradle/（执行历史），禁用 build cache
set -uo pipefail
cd "$HOME/work/tutorialmod"
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

./gradlew --stop >/dev/null 2>&1 || true
rm -rf build .gradle
echo "=== 清理后 ==="
ls -a | tr '\n' ' '; echo
START=$(date +%s)
./gradlew build --offline --no-build-cache --no-daemon --console=plain 2>&1 | grep -vE 'WARNING:|^Note:|warning: \[' | tail -40
RC=${PIPESTATUS[0]}
END=$(date +%s)
echo "### COLD_OFFLINE_EXIT=$RC  SECONDS=$((END-START)) ###"
stat -c '%n | %s bytes | %y' build/libs/*.jar 2>/dev/null || echo "(no jar)"
