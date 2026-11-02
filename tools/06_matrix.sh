#!/usr/bin/env bash
P=http://127.0.0.1:7897
t() { # name url
  printf '%-46s ' "$1"
  curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 30 -x "$P" -r 0-1023 "$2" || echo "FAIL"
}
echo "--- via proxy $P ---"
t "services.gradle.org zip"   https://services.gradle.org/distributions/gradle-9.2.1-bin.zip
t "piston-meta.mojang.com"    https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
t "repo1.maven.org"           https://repo1.maven.org/maven2/
t "maven.neoforged.net"       https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml
t "plugins.gradle.org"        https://plugins.gradle.org/m2/
echo "--- direct (noproxy) ---"
d() {
  printf '%-46s ' "$1"
  curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 --noproxy '*' -r 0-1023 "$2" || echo "FAIL"
}
d "services.gradle.org zip"   https://services.gradle.org/distributions/gradle-9.2.1-bin.zip
d "piston-meta.mojang.com"    https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
d "repo1.maven.org"           https://repo1.maven.org/maven2/
d "maven.neoforged.net"       https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml
d "plugins.gradle.org"        https://plugins.gradle.org/m2/
