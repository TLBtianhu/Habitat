#!/usr/bin/env bash
set -euo pipefail
SRC="/mnt/c/mc模组教学/demo/tutorialmod"
DST="$HOME/work/tutorialmod"
mkdir -p "$HOME/work"
rm -rf "$DST"
mkdir -p "$DST"
# 只复制源码与构建脚本，排除 build/ run/ .gradle/ 等大目录
(
  cd "$SRC"
  tar -cf - --exclude=./build --exclude=./run --exclude=./.gradle . | tar -xf - -C "$DST"
)
chmod +x "$DST/gradlew"
echo "=== copy done ==="
du -sh "$DST"
find "$DST" -maxdepth 1 | sort
echo "=== gradle-wrapper.properties ==="
cat "$DST/gradle/wrapper/gradle-wrapper.properties"
echo "=== checksum of original vs copy ==="
sha1sum "$SRC/build.gradle" "$DST/build.gradle" "$SRC/gradle.properties" "$DST/gradle.properties"
