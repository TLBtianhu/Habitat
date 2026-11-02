#!/usr/bin/env bash
set -u
echo "=== 监听 ==="
ss -lnt | grep -E '3007|3008|8777' || echo "none"
echo "=== WSL 内访问 viewer（绕代理）==="
for u in "http://127.0.0.1:3007/" "http://[::1]:3007/" "http://localhost:3007/"; do
  code=$(curl -gs --noproxy '*' -o /tmp/v.html -w '%{http_code}' --max-time 6 "$u" 2>/dev/null || echo FAIL)
  size=$(wc -c < /tmp/v.html 2>/dev/null || echo 0)
  echo "$u -> $code size=$size"
done
echo "=== 首页片段 ==="
head -c 200 /tmp/v.html 2>/dev/null; echo
