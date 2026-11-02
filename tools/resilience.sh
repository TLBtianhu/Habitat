#!/usr/bin/env bash
# P1 韧性 + 隔离 实测（以 root 运行）
set -u
PID=$(systemctl show -p MainPID --value fishbowl-body.service)
echo "=== main pid=$PID ==="

echo "=== A. 挂载命名空间里看得见 /mnt/c 吗 ==="
nsenter -t "$PID" -m -- bash -c 'echo "ls /mnt:"; ls /mnt 2>&1; echo "ls /mnt/c:"; ls /mnt/c 2>&1 | head -3'

echo "=== B. 杀 Chrome，看身体是否自动重启它 ==="
CPID=$(pgrep -f 'chrome-headless-shell --no-sandbox' | head -1)
echo "chrome pid=$CPID"
kill -9 "$CPID" 2>/dev/null
sleep 7
echo "chrome 进程数: $(pgrep -fc chrome-headless-shell || true)"
echo "screencast 日志:"
grep -c screencastFrame /opt/habitat/fishbowl/body.log || true

echo "=== C. 杀主进程，看 systemd 是否重启 ==="
kill -9 "$PID" 2>/dev/null
sleep 8
echo "active: $(systemctl is-active fishbowl-body.service)"
echo "NRestarts: $(systemctl show -p NRestarts --value fishbowl-body.service)"
tail -5 /opt/habitat/fishbowl/body.log
