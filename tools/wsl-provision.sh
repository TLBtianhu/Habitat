#!/usr/bin/env bash
# Fishbowl WSL 原生环境准备：JDK / Node / 本地世界，全部装在 $HOME/opt 与 $HOME/fishbowl
# 可重复执行；不依赖宿主 JDK，不依赖宿主 C 盘已装软件。
set -euo pipefail

HOME_DIR="${HOME:-/opt/habitat}"
OPT="$HOME_DIR/opt"
mkdir -p "$OPT" "$HOME_DIR/fishbowl"

have() { command -v "$1" >/dev/null 2>&1; }

install_jdk() {
  if [ -x "$OPT/jdk25/bin/java" ]; then
    echo "[jdk] 已存在：$("$OPT/jdk25/bin/java" -version 2>&1 | head -1)"
    return
  fi
  echo "[jdk] 下载 Temurin 25（原生 WSL）"
  local tmp="$OPT/jdk25.tmp"
  mkdir -p "$tmp"
  local url="https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse"
  curl -fL --retry 3 --max-time 900 "$url" -o "$OPT/jdk25.tar.gz"
  tar -xzf "$OPT/jdk25.tar.gz" -C "$tmp" --strip-components=1
  mv "$tmp" "$OPT/jdk25"
  rm -f "$OPT/jdk25.tar.gz"
  "$OPT/jdk25/bin/java" -version
}

install_node() {
  if [ -x "$OPT/node22/bin/node" ]; then
    echo "[node] 已存在：$("$OPT/node22/bin/node" -v)"
    return
  fi
  echo "[node] 下载 Node 22"
  local tmp="$OPT/node22.tmp"
  mkdir -p "$tmp"
  curl -fL --retry 3 --max-time 900 \
    "https://npmmirror.com/mirrors/node/v22.18.0/node-v22.18.0-linux-x64.tar.xz" -o "$OPT/node22.tar.xz"
  tar -xJf "$OPT/node22.tar.xz" -C "$tmp" --strip-components=1
  mv "$tmp" "$OPT/node22"
  rm -f "$OPT/node22.tar.xz"
  "$OPT/node22/bin/node" -v
}

install_tts() {
  if have espeak-ng; then
    echo "[tts] 已存在：$(espeak-ng --version | head -1)"
    return
  fi
  echo "[tts] 安装轻量 espeak-ng（通用测试音色）"
  if [ "$(id -u)" -eq 0 ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y espeak-ng
  elif command -v sudo >/dev/null 2>&1; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y espeak-ng
  else
    echo "需要 root 安装 espeak-ng：apt-get install -y espeak-ng" >&2
    return 1
  fi
}

install_world() {
  if [ -x "$OPT/jdk25/bin/java" ]; then
    bash "$(dirname "$0")/wsl-local-world.sh" status || true
  fi
}

install_jdk
install_node
install_tts
install_world
echo "provision 完成。启动世界：bash tools/wsl-local-world.sh start"
