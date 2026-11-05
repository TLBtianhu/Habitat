#!/usr/bin/env bash
# 旧 mineflayer 服务已被 mc/mc-launcher 适配器取代；不伪装为已连接的世界。
set -euo pipefail
ROOT="${HABITAT_INSTANCE_ROOT:-/opt/habitat}"
NODE="$ROOT/runtime/node22/bin/node"
if [ ! -x "$NODE" ] || [ ! -f "$ROOT/app/adapters/mc/provider.mjs" ]; then
  echo 'legacy world compatibility: runtime not installed; no world started' >&2
  exit 0
fi
if [ -f "$ROOT/state/instance.env" ]; then
  set -a
  # 该文件由 Habitat 生成，仅含实例路径与非秘密配置。
  . "$ROOT/state/instance.env"
  set +a
fi
status="$("$NODE" "$ROOT/app/control/adapter-host.mjs" status)"
LEGACY_STATUS="$status" "$NODE" --input-type=module -e '
const status = JSON.parse(process.env.LEGACY_STATUS);
const launcher = status["mc-launcher"];
console.log(`legacy world compatibility: mc adapter running=${Boolean(status.mc?.running)}, mc-launcher running=${Boolean(launcher?.running)}; no legacy mineflayer process started`);
if (!status.mc && !launcher) {
  console.log("MC adapters are unavailable; no world started");
}
'
