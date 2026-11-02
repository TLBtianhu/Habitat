#!/usr/bin/env bash
# 14: 恢复项目内 .gradle/caches/minecraft，然后按题目要求重做「清 build + --offline」
set -uo pipefail
cd "$HOME/work/tutorialmod"
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

echo "########## A) 在线构建，恢复项目内缓存 ##########"
S=$(date +%s)
./gradlew build --console=plain 2>&1 | grep -vE 'WARNING:|^Note:|warning: \[' | tail -12
echo "### ONLINE2_EXIT=${PIPESTATUS[0]}  SECONDS=$(( $(date +%s) - S )) ###"
echo "=== 项目内 .gradle/caches/minecraft ==="
du -sh .gradle/caches/minecraft 2>/dev/null; ls -la .gradle/caches/minecraft/versions/26.3/ 2>/dev/null

echo
echo "########## B) 清 build/ 后离线构建（题目要求） ##########"
rm -rf build
S=$(date +%s)
./gradlew build --offline --console=plain 2>&1 | grep -vE 'WARNING:|^Note:|warning: \[' | tail -12
echo "### OFFLINE_FINAL_EXIT=${PIPESTATUS[0]}  SECONDS=$(( $(date +%s) - S )) ###"
stat -c 'ARTIFACT: %n | %s bytes' build/libs/*.jar 2>/dev/null || echo "(no jar)"
