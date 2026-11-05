#!/usr/bin/env bash
# 停机回归：auto-restart 的 activating 单元也必须收到停止，不操作真实 systemd/docker。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -eu
if [ "$1" = show ]; then
  if [ "$2" = fishbowl-world.service ]; then echo activating; else echo inactive; fi
elif [ "$1" = stop ]; then
  printf '%s\n' "$2" >>"$HABITAT_STOP_TEST_LOG"
fi
EOF
cat >"$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod 700 "$TMP/bin/systemctl" "$TMP/bin/docker"
export HABITAT_STOP_TEST_LOG="$TMP/stopped.log"
: >"$HABITAT_STOP_TEST_LOG"
HABITAT_NODE=/bin/true PATH="$TMP/bin:/usr/bin:/bin" bash "$ROOT/tools/wsl-stop.sh"
grep -Fx 'fishbowl-world.service' "$HABITAT_STOP_TEST_LOG" >/dev/null
count="$(wc -l <"$HABITAT_STOP_TEST_LOG")"
[ "$count" -eq 1 ]
echo 'ok: activating/auto-restart legacy unit is stopped without touching real services'
