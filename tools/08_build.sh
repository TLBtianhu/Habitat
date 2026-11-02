#!/usr/bin/env bash
# 08: 首次在线构建
set -uo pipefail
DST="$HOME/work/tutorialmod"
cd "$DST"

export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

LOG="$HOME/work/build-online.log"
START=$(date +%s)
echo "### START $(date -Is) ###"
./gradlew build --console=plain --stacktrace 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
END=$(date +%s)
echo "### BUILD_EXIT=$RC  BUILD_SECONDS=$((END-START)) ###"
echo "=== artifacts ==="
ls -la build/libs/ 2>/dev/null || echo "(no build/libs)"
echo "=== ~/.gradle size ==="
du -sh "$HOME/.gradle" 2>/dev/null
