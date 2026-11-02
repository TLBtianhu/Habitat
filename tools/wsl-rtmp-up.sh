#!/usr/bin/env bash
# RTMP/RTMPS Outlet：目标只从主人配置读取，不打印地址或 streamKey。
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-d3d12}"
export FB_GPU_ENCODER="${FB_GPU_ENCODER:-cpu}"
export FB_DESKTOP_URL="${FB_DESKTOP_URL:-http://127.0.0.1:9260}"
export FB_AUDIO_URL="${FB_AUDIO_URL:-http://127.0.0.1:9271}"
export FB_ART=/var/lib/habitat/artifacts/rtmp
export FB_HLS=0
CONFIG="${HABITAT_BILIBILI_LIVE_CONFIG:-/etc/habitat/bilibili-live.json}"
FB_RTMP="$(node -e 'const fs=require("fs");const p=process.argv[1];const s=fs.statSync(p);if((s.mode&0o077)!==0)throw new Error("config permissions too open");const c=JSON.parse(fs.readFileSync(p,"utf8"));if(!/^rtmps?:\/\//.test(c.rtmpUrl||"")||!c.streamKey)throw new Error("invalid rtmp config");const u=c.rtmpUrl,k=c.streamKey;process.stdout.write(u.endsWith("/")||k.startsWith("?")?u+k:u+"/"+k)' "$CONFIG")"
export FB_RTMP
mkdir -p "$FB_ART" /var/lib/habitat/logs
cd /opt/habitat/app
exec node tools/pipeline.mjs >>/var/lib/habitat/logs/rtmp.log 2>&1
