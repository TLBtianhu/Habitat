#!/usr/bin/env bash
# Habitat provisioning：root 仅用于目录/单元安装；staging→校验→切换→健康检查→回滚。
set -euo pipefail

ROOT=/opt/habitat
APP="$ROOT/app"
ETC="$ROOT/config"
VAR="$ROOT/data"
RUNTIME="$ROOT/runtime"
STATE="$ROOT/state"
TMP="$ROOT/tmp"
SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HABITAT_USER="${HABITAT_USER:-$(id -un 1000 2>/dev/null || echo tlb3)}"
HABITAT_GROUP="$(id -gn "$HABITAT_USER")"
NODE_HOME="$RUNTIME/node22"
UNITS=(habitat-stage habitat-control habitat-desktop habitat-agent habitat-voice habitat-audio habitat-outlet-supervisor habitat-pipeline)
ITEMS=(tools runtime agent desktop voice audio display identity director control stage stream clients adapters plugins mcp assets-packs)

[[ "$APP" == /opt/habitat/app && "$ETC" == /opt/habitat/config && "$VAR" == /opt/habitat/data ]]
mkdir -p "$APP" "$ETC" "$VAR/world-server" "$VAR/artifacts" "$VAR/logs" "$VAR/hls" "$VAR/outlets" "$VAR/adapters" "$VAR/cache/tts" "$VAR/models/tts" "$VAR/outbox" "$VAR/pump" "$VAR/plugins" "$VAR/plugins/downloads" "$VAR/plugins/installed" "$STATE" "$TMP"

STAGE="$APP/.install-staging-$$"
BACKUP="$APP/.install-backup-$$"
mkdir -p "$STAGE" "$BACKUP"
changed=()
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "install failed; restoring previous app layer" >&2
    for item in "${changed[@]}"; do
      rm -rf "$APP/$item"
      if [ -e "$BACKUP/$item" ]; then mv "$BACKUP/$item" "$APP/$item"; fi
    done
    systemctl start habitat-stage habitat-control habitat-desktop habitat-audio habitat-voice habitat-agent habitat-outlet-supervisor 2>/dev/null || true
    for _ in $(seq 1 20); do
      if curl --noproxy '*' --max-time 2 -fsS http://127.0.0.1:9240/status >/dev/null 2>&1; then break; fi
      sleep 1
    done
  fi
  rm -rf "$STAGE" "$BACKUP"
  exit "$rc"
}
trap rollback ERR

# 只在 staging 解包/复制，不直接覆盖正在运行的应用层；依赖按 lockfile 安装。
for item in "${ITEMS[@]}"; do
  if [ -e "$SRC/$item" ]; then
    mkdir -p "$STAGE/$item"
    tar -C "$SRC" \
      --exclude='node_modules' --exclude='*/node_modules' \
      --exclude='artifacts' --exclude='*/artifacts' \
      --exclude='.git' --exclude='*/.git' \
      --exclude='dist' --exclude='*/dist' \
      --exclude='world-server' --exclude='*/world-server' \
      --exclude='work' --exclude='*/work' \
      --exclude='*.log' --exclude='*/.tmp' \
      -cf - "$item" | tar -C "$STAGE" -xf -
  fi
done
for file in package.json package-lock.json; do
  if [ -f "$SRC/$file" ]; then cp "$SRC/$file" "$STAGE/$file"; fi
done
if [ -f "$SRC/worlds.json" ] && [ ! -f "$ETC/worlds.json" ]; then cp "$SRC/worlds.json" "$ETC/worlds.json"; fi

systemctl stop habitat-agent habitat-outlet-supervisor habitat-pipeline habitat-audio habitat-voice habitat-desktop habitat-control habitat-stage

for item in "${ITEMS[@]}" package.json package-lock.json; do
  if [ -e "$STAGE/$item" ]; then
    if [ -e "$APP/$item" ]; then mv "$APP/$item" "$BACKUP/$item"; fi
    mv "$STAGE/$item" "$APP/$item"
    changed+=("$item")
  fi
done

if [ -f "$APP/package.json" ]; then
  export PATH="$NODE_HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  cd "$APP" && "$NODE_HOME/bin/npm" install --omit=dev --no-audit --no-fund
fi

for name in "${UNITS[@]}"; do
  if [ -f "$APP/tools/wsl-$name.service" ]; then
    cp "$APP/tools/wsl-$name.service" "/etc/systemd/system/$name.service"
    sed -i \
      -e "s/^User=.*/User=$HABITAT_USER/" \
      -e "s/^Group=.*/Group=$HABITAT_GROUP/" \
      -e "s#/home/[^/]*/opt/node22#$NODE_HOME#g" \
      -e "s#/home/[^/]*/opt#$RUNTIME#g" \
      -e "s#/var/lib/habitat#$VAR#g" \
      -e "s#/etc/habitat#$ETC#g" \
      -e "s#/home/[^/]*#$VAR/home#g" \
      -e '/^Environment=LD_LIBRARY_PATH=/d' \
      -e '/^EnvironmentFile=/d' \
      -e "/^\[Service\]/a EnvironmentFile=$STATE/instance.env" \
      "/etc/systemd/system/$name.service"
  fi
done
chmod +x "$APP/tools/wsl-pipeline-up.sh"
if [ -f "$APP/tools/habitat.logrotate" ]; then cp "$APP/tools/habitat.logrotate" /etc/logrotate.d/habitat; fi

chown -R "$HABITAT_USER:$HABITAT_GROUP" "$ETC"
chown "$HABITAT_USER:$HABITAT_GROUP" "$VAR" "$VAR/world-server"
chown -R "$HABITAT_USER:$HABITAT_GROUP" "$VAR/artifacts" "$VAR/logs" "$VAR/hls" "$VAR/outlets" "$VAR/adapters" "$VAR/cache/tts" "$VAR/models" "$VAR/outbox" "$VAR/pump" "$VAR/plugins"
find "$VAR" -maxdepth 1 -type f -exec chown "$HABITAT_USER:$HABITAT_GROUP" {} +
chmod -R a+rX "$APP"
"$NODE_HOME/bin/node" --check "$APP/agent/run-continuous.mjs"

"$NODE_HOME/bin/node" "$APP/tools/write-instance-env.mjs" --root "$ROOT"
systemctl daemon-reload
systemctl enable habitat-stage habitat-control habitat-desktop habitat-agent habitat-voice habitat-audio habitat-outlet-supervisor
systemctl start habitat-stage habitat-control habitat-desktop habitat-audio habitat-voice habitat-agent habitat-outlet-supervisor
for _ in $(seq 1 20); do
  if curl --noproxy '*' --max-time 2 -fsS http://127.0.0.1:9240/status >/dev/null 2>&1 && curl --noproxy '*' --max-time 2 -fsS http://127.0.0.1:9240/pump/status >/dev/null 2>&1; then break; fi
  sleep 1
done
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9240/status >/dev/null
curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:9240/pump/status >/dev/null

cat > "$STATE/install.json" <<EOF
{
  "installedAt": "$(date -Is)",
  "source": "$SRC",
  "root": "$ROOT",
  "app": "$APP",
  "config": "$ETC",
  "data": "$VAR",
  "runtime": "$RUNTIME",
  "state": "$STATE",
  "user": "$HABITAT_USER",
  "group": "$HABITAT_GROUP"
}
EOF
rm -rf "$STAGE" "$BACKUP"
trap - ERR

echo "installed WSL user environment (provisioning only):"
echo "  app=$APP"
echo "  config=$ETC"
echo "  data=$VAR"
echo "  user=$HABITAT_USER group=$HABITAT_GROUP"
