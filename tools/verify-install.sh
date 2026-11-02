#!/usr/bin/env bash
# 真实运行账号的安装权限验收：不以 root 的写入能力冒充服务可写。
set -euo pipefail
APP=/opt/habitat/app
VAR=/var/lib/habitat
USER_NAME="${HABITAT_USER:-tlb3}"
NODE_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)/opt/node22"

getent passwd "$USER_NAME" >/dev/null
for dir in "$VAR" "$VAR/outbox" "$VAR/pump" "$VAR/logs" "$VAR/hls" "$VAR/outlets" "$VAR/adapters" "$VAR/cache/tts" "$VAR/models" "$VAR/world-server" "$VAR/plugins" "$VAR/plugins/downloads" "$VAR/plugins/installed"; do
  runuser -u "$USER_NAME" -- test -w "$dir"
done
for file in "$VAR/control-tasks.json" "$VAR/system-chat.jsonl" "$VAR/utterances.jsonl" "$VAR/agent-system-chat.json" "$VAR/outbox/agent.json" "$VAR/pump/system-chat.json" "$VAR/lifecycle.json" "$VAR/skill-library.json"; do
  if [ -e "$file" ]; then runuser -u "$USER_NAME" -- test -w "$file"; fi
done

DEV_TOKEN="$(printf '%s%s' 'a11e9f' '83618f4451a79533ef02db51d4')"
if grep -R -n -E "${DEV_TOKEN}|sk-[A-Za-z0-9]{20,}" "$APP/agent" "$APP/clients" "$APP/tools" --include='*.mjs'; then
  echo '发行运行目录包含开发秘密' >&2
  exit 1
fi
if "$NODE_HOME/bin/node" "$APP/tools/bridge.mjs" >/tmp/habitat-legacy-bridge-check.log 2>&1; then
  echo '旧无鉴权桥未默认拒绝' >&2
  exit 1
fi
test -d "$APP/node_modules/ws"
test -d "$APP/node_modules/@resvg/resvg-js"
test "$(systemctl show -p User --value habitat-agent)" = "$USER_NAME"
for file in /etc/habitat/owner.token /etc/habitat/agent.token /etc/habitat/mcpfabric.token; do
  test -f "$file"
  test "$(stat -c '%a' "$file")" = 600
done
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9240/status >/dev/null
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9240/pump/status >/dev/null
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9260/status >/dev/null
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9270/status >/dev/null
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9272/status >/dev/null

echo "ok: 普通服务账号 $USER_NAME 可写全部运行目录，秘密权限、旧桥禁用、依赖和健康检查通过"
