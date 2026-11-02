#!/usr/bin/env bash
set -u
pkill -f viewer-relay.py 2>/dev/null
sleep 0.5
nohup python3 "/opt/habitat/src/tools/viewer-relay.py" > /tmp/viewer-relay.log 2>&1 &
sleep 1.5
cat /tmp/viewer-relay.log
ss -lnt | grep -E '3007|3008'
echo "=== 自测 / ==="
curl -s -o /tmp/vroot.html -w 'status=%{http_code} size=%{size_download}\n' --max-time 8 http://127.0.0.1:3008/
head -c 300 /tmp/vroot.html; echo
