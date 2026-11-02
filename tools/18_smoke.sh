#!/usr/bin/env bash
cd "$HOME/work/tutorialmod" || exit 1
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:/usr/local/bin:/usr/bin:/bin"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"
rm -rf build
S=$(date +%s)
./gradlew build --offline --console=plain 2>&1 | grep -E '^BUILD|actionable'
echo "OFFLINE_EXIT=${PIPESTATUS[0]} SECONDS=$(( $(date +%s) - S ))"
ls -l build/libs/
du -sh "$HOME/.gradle" "$HOME/opt/jdk25"
