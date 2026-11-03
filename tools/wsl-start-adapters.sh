#!/usr/bin/env bash
# Habitat 启动适配器：只启动已经配置过的 NapCat 容器，不创建新实例。
set -euo pipefail
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ -n "$(docker ps -aq --filter 'name=^/napcat$')" ]; then
    docker start napcat >/dev/null
  fi
fi
