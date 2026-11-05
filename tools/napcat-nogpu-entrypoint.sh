#!/usr/bin/env bash
# 无显示环境的 NapCat：仅修改临时启动脚本，不改镜像或持久化数据。
set -euo pipefail
sed 's#/opt/QQ/qq --no-sandbox#/opt/QQ/qq --no-sandbox --disable-gpu#' /app/entrypoint.sh > /tmp/habitat-nogpu-entrypoint.sh
exec bash /tmp/habitat-nogpu-entrypoint.sh
