#!/usr/bin/env bash
# 在 WSL 用户态启动桥：不再依赖 Windows 桥进程
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
APP=/opt/habitat/app
mkdir -p /var/lib/habitat/artifacts /var/lib/habitat/logs
cd "$APP"
exec node "$APP/tools/bridge.mjs" >>/var/lib/habitat/logs/bridge.log 2>&1
