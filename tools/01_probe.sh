#!/usr/bin/env bash
# 环境与网络探针
echo "=== OS ==="
source /etc/os-release; echo "$PRETTY_NAME"
echo "=== tools ==="
for c in java javac curl unzip file git tar; do printf '%-6s ' "$c"; command -v "$c" || echo "(missing)"; done
echo "=== java (system) ==="
java -version 2>&1 | head -3 || echo "no system java"
echo "=== env proxies ==="
env | grep -i proxy || echo "(none)"
echo "=== apt proxy conf ==="
grep -ri proxy /etc/apt/apt.conf.d/ 2>/dev/null | head -5
echo "=== resources ==="
nproc
free -g | head -2
df -h /home | tail -1
echo "=== gradle cache ==="
du -sh ~/.gradle 2>/dev/null || echo "no ~/.gradle"
echo
echo "=== net: adoptium API ==="
echo -n "proxy : "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 25 -x http://127.0.0.1:7897 https://api.adoptium.net/v3/info/available_releases || echo FAIL
echo -n "direct: "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 15 https://api.adoptium.net/v3/info/available_releases || echo FAIL
echo "=== net: services.gradle.org ==="
echo -n "proxy : "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 25 -x http://127.0.0.1:7897 https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256 || echo FAIL
echo -n "direct: "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 20 https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256 || echo FAIL
echo "=== net: maven.neoforged.net ==="
echo -n "proxy : "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 25 -x http://127.0.0.1:7897 https://maven.neoforged.net/releases/ || echo FAIL
echo -n "direct: "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 20 https://maven.neoforged.net/releases/ || echo FAIL
echo "=== net: piston-meta.mojang.com ==="
echo -n "proxy : "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 25 -x http://127.0.0.1:7897 https://piston-meta.mojang.com/mc/game/version_manifest_v2.json || echo FAIL
echo -n "direct: "; curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 20 https://piston-meta.mojang.com/mc/game/version_manifest_v2.json || echo FAIL
