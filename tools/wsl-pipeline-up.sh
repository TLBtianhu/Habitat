#!/usr/bin/env bash
# WSL 原生 Outlet：从 Desktop Compositor 拉取合成帧，ffmpeg 编码输出。
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-d3d12}"
export FB_GPU_ENCODER="${FB_GPU_ENCODER:-cpu}"
export FB_DESKTOP_URL="${FB_DESKTOP_URL:-http://127.0.0.1:9260}"
export FB_AUDIO_URL="${FB_AUDIO_URL:-http://127.0.0.1:9271}"
export FB_ART=/var/lib/habitat/artifacts
export FB_HLS=1
export FB_HLS_DIR=/var/lib/habitat/hls
mkdir -p "$FB_ART" "$FB_HLS_DIR" /var/lib/habitat/logs
# HLS 是本次播出的运行时产物；启动前清掉上次残留，绝不回放旧直播。
rm -f -- "$FB_HLS_DIR/live.m3u8" "$FB_HLS_DIR"/live*.ts
cd /opt/habitat/app
exec node tools/pipeline.mjs >>/var/lib/habitat/logs/pipeline.log 2>&1
