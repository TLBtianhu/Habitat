#!/usr/bin/env bash
# 安装 fishbowl-world.service（MC 服务端 + bot + viewer）
set -euo pipefail
install -d -o tlb3 -g tlb3 /opt/habitat/fishbowl
cp "/opt/habitat/src/tools/world-up.sh" /opt/habitat/fishbowl/world-up.sh
chmod 0755 /opt/habitat/fishbowl/world-up.sh
chown tlb3:tlb3 /opt/habitat/fishbowl/world-up.sh

pkill -f 'fishbowl/bot/run.js' 2>/dev/null || true

cat > /etc/systemd/system/fishbowl-world.service <<'EOS'
[Unit]
Description=Fishbowl world (Minecraft server + mineflayer bot + viewer)
After=network.target

[Service]
Type=simple
User=tlb3
Group=tlb3
Environment=HOME=/opt/habitat
ExecStart=/bin/bash /opt/habitat/fishbowl/world-up.sh
Restart=always
RestartSec=5
StandardOutput=append:/opt/habitat/fishbowl/world.log
StandardError=append:/opt/habitat/fishbowl/world.log

[Install]
WantedBy=multi-user.target
EOS

systemctl daemon-reload
systemctl enable fishbowl-world.service >/dev/null
systemctl restart fishbowl-world.service
sleep 12
systemctl is-active fishbowl-world.service || true
ss -lnt | grep -E '25565|3007' || echo "ports missing"
echo "=== log ==="
tail -12 /opt/habitat/fishbowl/world.log
