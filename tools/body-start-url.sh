#!/usr/bin/env bash
# 让身体直接打开世界视图
set -euo pipefail
cp "/opt/habitat/src/tools/body.py" /opt/habitat/fishbowl/body.py
chown tlb3:tlb3 /opt/habitat/fishbowl/body.py

mkdir -p /etc/systemd/system/fishbowl-body.service.d
cat > /etc/systemd/system/fishbowl-body.service.d/start-url.conf <<'EOS'
[Service]
Environment=FB_START_URL=http://localhost:3007/
EOS

systemctl daemon-reload
systemctl restart fishbowl-body.service
sleep 10
systemctl is-active fishbowl-body.service || true
tail -8 /opt/habitat/fishbowl/body.log
