#!/usr/bin/env bash
# WSL 原生舞台静态服务
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export FB_STAGE_ROOT=/opt/habitat/app/stage
export FB_WHALE_ROOT=/opt/habitat/app/assets-packs/whale-girl/model
export FB_DAFEIYU_ROOT=/opt/habitat/app/assets-packs/dafeiyu
cd /opt/habitat/app
exec node tools/stage-server.mjs >>/var/lib/habitat/logs/stage.log 2>&1
