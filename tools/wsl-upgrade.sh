#!/usr/bin/env bash
# 升级为管道版身体：Type=notify + WatchdogSec + 隐藏 Windows 挂载
set -euo pipefail

echo "=== 1. 同步 body.py ==="
install -d -o tlb3 -g tlb3 /opt/habitat/fishbowl
cp "/opt/habitat/src/tools/body.py" /opt/habitat/fishbowl/body.py
chown tlb3:tlb3 /opt/habitat/fishbowl/body.py

echo "=== 2. 单元：notify + watchdog + 隐藏 /mnt/c ==="
cat > /etc/systemd/system/fishbowl-body.service <<'EOS'
[Unit]
Description=Fishbowl sandbox body (headless Chromium, CDP over pipe)
After=network.target

[Service]
Type=notify
NotifyAccess=main
WatchdogSec=30
Restart=always
RestartSec=3
User=tlb3
Group=tlb3
Environment=HOME=/opt/habitat
Environment=LD_LIBRARY_PATH=/opt/habitat/runtime/deps/usr/lib/x86_64-linux-gnu
Environment=FB_HOST=127.0.0.1
Environment=FB_PORT=9224
ExecStart=/usr/bin/python3 /opt/habitat/fishbowl/body.py
StandardOutput=append:/opt/habitat/fishbowl/body.log
StandardError=append:/opt/habitat/fishbowl/body.log

# 隔离：把 Windows 盘藏起来（只对这个服务生效，不影响别的 WSL 用法）
InaccessiblePaths=-/mnt/c
InaccessiblePaths=-/mnt/d
InaccessiblePaths=-/mnt/wslg

[Install]
WantedBy=multi-user.target
EOS

echo "=== 3. 重启 ==="
pkill -f "tools/body.py" 2>/dev/null || true
pkill -f chrome-headless-shell 2>/dev/null || true
sleep 1
systemctl daemon-reload
systemctl restart fishbowl-body.service
sleep 6

echo "=== 4. 状态 ==="
systemctl is-active fishbowl-body.service || true
systemctl show fishbowl-body.service -p WatchdogUSec -p Type -p NRestarts 2>/dev/null || true
echo "=== 5. 进程 ==="
pgrep -af "fishbowl/body.py|chrome-headless-shell" | head -3 || echo "no proc"
echo "=== 6. 端口（应为空：管道版不监听）==="
ss -lnt 2>/dev/null | grep -E '9222|9223|9224' || echo "no listening ports in wsl"
echo "=== 7. 日志尾 ==="
tail -12 /opt/habitat/fishbowl/body.log 2>/dev/null || true
