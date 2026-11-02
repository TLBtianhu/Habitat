#!/usr/bin/env bash
# WSL 原生第一视角相机
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export FB_SESSION=/var/lib/habitat/artifacts/world-session.json
export LD_LIBRARY_PATH="/opt/habitat/runtime/deps/usr/lib/x86_64-linux-gnu"
cd /opt/habitat/app/bot-host
exec node camera.js >>/var/lib/habitat/logs/camera.log 2>&1
