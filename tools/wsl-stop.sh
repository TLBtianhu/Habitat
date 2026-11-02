#!/usr/bin/env bash
# Habitat 正常停机：只停声明中的服务，不按 PID 乱杀。失败时不得继续关 VM。
set -u
FAILED=0
NODE=/opt/habitat/runtime/node22/bin/node
stop_unit() {
  local unit="$1"
  if systemctl is-active --quiet "$unit"; then
    echo "[stop] $unit"
    if ! systemctl stop "$unit"; then
      echo "[stop] failed: $unit" >&2
      FAILED=1
    fi
  fi
}

# 1. 先停新决策与新动作；Agent 自己有界等待当前 tick。
stop_unit habitat-agent.service
stop_unit habitat-pipeline.service

# 2. 停适配器与所有 Outlet；由各自监督者确认真实退出。
for name in qq bilibili mc; do
  if [ -f /opt/habitat/app/control/adapter-host.mjs ]; then
    "$NODE" /opt/habitat/app/control/adapter-host.mjs stop "$name" || true
  fi
done
stop_unit habitat-outlet-supervisor.service

# 3. 停音频生产、桌面捕获与合成。
stop_unit habitat-voice.service
stop_unit habitat-audio.service
stop_unit habitat-desktop.service

# 4. 最后停控制面、舞台及已知旧 Habitat 单元。
stop_unit habitat-control.service
stop_unit habitat-stage.service
for unit in fishbowl-body.service fishbowl-world.service habitat-bridge.service habitat-camera.service habitat-identity.service; do
  stop_unit "$unit"
done

if [ "$FAILED" -ne 0 ]; then
  echo '[stop] one or more units failed; VM shutdown must be aborted' >&2
  exit 1
fi
echo '[stop] all Habitat services stopped cleanly'
