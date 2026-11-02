#!/usr/bin/env bash
# 07: 下载 Gradle 发行版（wrapper），记录版本与耗时
set -uo pipefail
DST="$HOME/work/tutorialmod"
cd "$DST"

export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"

# 取消注释代理四行（幂等）
sed -i 's/^#systemProp\.http\.proxyHost=/systemProp.http.proxyHost=/;
        s/^#systemProp\.http\.proxyPort=/systemProp.http.proxyPort=/;
        s/^#systemProp\.https\.proxyHost=/systemProp.https.proxyHost=/;
        s/^#systemProp\.https\.proxyPort=/systemProp.https.proxyPort=/' gradle.properties
echo "=== gradle.properties (proxy part) ==="
grep -n 'proxy' gradle.properties

echo "=== JAVA_HOME=$JAVA_HOME ==="
"$JAVA_HOME/bin/java" -version 2>&1 | head -1
echo "=== GRADLE_OPTS=$GRADLE_OPTS ==="
echo

START=$(date +%s)
echo "### ./gradlew --version  (触发发行版下载) ###"
./gradlew --version --console=plain
RC=$?
END=$(date +%s)
echo "### WRAPPER_EXIT=$RC  WRAPPER_SECONDS=$((END-START)) ###"
echo "=== dist dir ==="
find "$HOME/.gradle/wrapper" -maxdepth 4 -type d | head -20
