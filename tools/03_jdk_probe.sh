#!/usr/bin/env bash
URL="https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse"
echo "=== release info (direct) ==="
curl -sS --max-time 20 --noproxy '*' "https://api.adoptium.net/v3/info/available_releases" | head -c 400
echo
echo "=== HEAD binary url (direct, follow) ==="
curl -sSL -o /dev/null -w 'code=%{http_code} url=%{url_effective} size=%{size_download} t=%{time_total}s\n' --max-time 60 --noproxy '*' -r 0-1023 "$URL" || echo FAIL
echo "=== HEAD binary url (proxy) ==="
curl -sSL -o /dev/null -w 'code=%{http_code} url=%{url_effective} t=%{time_total}s\n' --max-time 60 -x http://127.0.0.1:7897 -r 0-1023 "$URL" || echo FAIL
echo "=== neo maven via proxy ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 30 -x http://127.0.0.1:7897 https://maven.neoforged.net/releases/ || echo FAIL
echo "=== plugins.gradle.org direct ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' https://plugins.gradle.org/m2/ || echo FAIL
echo "=== plugins.gradle.org proxy ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 25 -x http://127.0.0.1:7897 https://plugins.gradle.org/m2/ || echo FAIL
echo "=== libraries.minecraft.net direct ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' https://libraries.minecraft.net/ || echo FAIL
echo "=== github.com direct ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' https://github.com/ || echo FAIL
echo "=== resources.neoforged.net / services.gradle.org dist direct HEAD ==="
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' -L https://services.gradle.org/distributions/gradle-9.2.1-bin.zip || echo FAIL
