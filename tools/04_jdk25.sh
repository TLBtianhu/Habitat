#!/usr/bin/env bash
set -euo pipefail
START=$(date +%s)
mkdir -p "$HOME/opt" "$HOME/work" "$HOME/.cache/dl"
cd "$HOME/.cache/dl"
URL="https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse"
echo "[1/4] download (direct, no proxy)"
curl -fSL --noproxy '*' --retry 2 --retry-delay 3 --max-time 900 \
     -o temurin25.tar.gz -w 'http=%{http_code} bytes=%{size_download} speed=%{speed_download}B/s t=%{time_total}s\n' "$URL"
ls -la temurin25.tar.gz
file temurin25.tar.gz
echo "[2/4] extract"
rm -rf "$HOME/opt/.jdk25-tmp"
mkdir -p "$HOME/opt/.jdk25-tmp"
tar -xzf temurin25.tar.gz -C "$HOME/opt/.jdk25-tmp"
TOPDIR=$(find "$HOME/opt/.jdk25-tmp" -maxdepth 1 -mindepth 1 -type d | head -1)
echo "topdir=$TOPDIR"
rm -rf "$HOME/opt/jdk25"
mv "$TOPDIR" "$HOME/opt/jdk25"
rm -rf "$HOME/opt/.jdk25-tmp"
echo "[3/4] verify layout"
ls -la "$HOME/opt/jdk25" | head -20
echo "[4/4] java -version"
"$HOME/opt/jdk25/bin/java" -version
"$HOME/opt/jdk25/bin/javac" -version
du -sh "$HOME/opt/jdk25"
END=$(date +%s)
echo "TOTAL_JDK_SECONDS=$((END-START))"
