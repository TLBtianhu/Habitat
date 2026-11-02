#!/usr/bin/env bash
# 运行时系统依赖：无头 Chrome 需要的共享库（不是开发态专有）
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2t64 libxss1 libxtst6
