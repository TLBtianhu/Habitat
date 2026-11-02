#!/usr/bin/env bash
echo "=== TCP 127.0.0.1:7897 ==="
timeout 8 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/7897' && echo TCP_OK || echo TCP_FAIL
echo "=== proxy: http://www.baidu.com ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 -x http://127.0.0.1:7897 http://www.baidu.com || echo FAIL
echo "=== proxy: https://www.baidu.com ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 -x http://127.0.0.1:7897 https://www.baidu.com || echo FAIL
echo "=== proxy: https://api.adoptium.net ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 25 -x http://127.0.0.1:7897 https://api.adoptium.net/v3/info/available_releases || echo FAIL
echo "=== DIRECT (noproxy): https://www.baidu.com ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 15 --noproxy '*' https://www.baidu.com || echo FAIL
echo "=== DIRECT (noproxy): api.adoptium.net ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' https://api.adoptium.net/v3/info/available_releases || echo FAIL
echo "=== DIRECT (noproxy): services.gradle.org ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256 || echo FAIL
echo "=== DIRECT (noproxy): maven.neoforged.net ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 25 --noproxy '*' https://maven.neoforged.net/releases/ || echo FAIL
echo "=== DIRECT (noproxy): piston-meta.mojang.com ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 25 --noproxy '*' https://piston-meta.mojang.com/mc/game/version_manifest_v2.json || echo FAIL
echo "=== DIRECT (noproxy): maven.fabricmc.net / repo1.maven.org ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 25 --noproxy '*' https://repo1.maven.org/maven2/ || echo FAIL
