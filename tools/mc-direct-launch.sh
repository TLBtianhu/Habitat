#!/usr/bin/env bash
# 直接启动原生 MC 客户端：JDK 21 + Fabric + mcpfabric + Iris
set -euo pipefail
DIR=/opt/habitat/app/mc-native
JAVA=/opt/habitat/runtime/jdk21/bin/java
export DISPLAY=:99
export GALLIUM_DRIVER=d3d12

mkdir -p "$DIR/natives"
# 解出 Linux natives（lwjgl 等）
for jar in $(find "$DIR/libraries" -name '*natives-linux*.jar' -o -name '*linux*.jar' | head -20); do
  case "$jar" in
    *natives*|*linux*) /opt/habitat/runtime/jdk21/bin/jar xf "$jar" -C "$DIR/natives" 2>/dev/null || true ;;
  esac
done

CP="$DIR/versions/1.21.4/1.21.4.jar:$(find "$DIR/libraries" -name '*.jar' ! -name 'asm-9.6.jar' | tr '\n' ':')"
mkdir -p /var/lib/habitat/logs
cd "$DIR"
exec "$JAVA" -Xms1G -Xmx3G \
  -Djava.library.path="$DIR/natives" \
  -cp "$CP" \
  net.fabricmc.loader.impl.launch.knot.KnotClient \
  --username DafeiyuNative4 \
  --version 1.21.4 \
  --gameDir "$DIR" \
  --assetsDir "$DIR/assets" \
  --assetIndex 1.21.4 \
  --quickPlayMultiplayer 127.0.0.1:25565 \
  --width 1280 --height 720 \
  >>/var/lib/habitat/logs/mc-native.log 2>&1
