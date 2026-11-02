#!/usr/bin/env bash
# 用户态启动她的 MC 客户端：不再从开发目录复制文件
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export FB_SESSION="${FB_SESSION:-/var/lib/habitat/artifacts/world-session.json}"
cd /opt/habitat/app/bot
exec node run.js
