#!/usr/bin/env bash
# WSL 原生本地世界：不依赖宿主 JDK、不依赖宿主 C 盘路径（缺 JAR 就自己下载）
set -u
DIR="/var/lib/habitat/world-server"
JAVA="${HABITAT_JAVA_HOME:-/opt/habitat/runtime/jdk25}/bin/java"
JAR="$DIR/server.jar"
LOG="$DIR/server.log"

port_open() {
  timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/25565" 2>/dev/null && { exec 3>&- 2>/dev/null; return 0; }
  return 1
}

ensure_files() {
  mkdir -p "$DIR"
  if [ ! -s "$JAR" ]; then
    if [ -f "/opt/habitat/src/mc-1.21.4/server.jar" ]; then
      cp "/opt/habitat/src/mc-1.21.4/server.jar" "$JAR"
    else
      curl -fsSL --retry 3 --max-time 600 \
        "https://bmclapi2.bangbang93.com/version/1.21.4/server" -o "$JAR"
    fi
  fi
  printf 'eula=true\n' > "$DIR/eula.txt"
  if [ ! -f "$DIR/server.properties" ]; then
    cat > "$DIR/server.properties" <<'EOF'
online-mode=false
motd=Fishbowl WSL world 1.21.4
max-players=8
view-distance=6
simulation-distance=4
spawn-protection=0
difficulty=normal
gamemode=survival
level-name=world
server-port=25565
enable-rcon=true
rcon.port=25575
rcon.password=fishbowl
EOF
  fi
}

start() {
  if port_open; then echo "world already up"; exit 0; fi
  ensure_files
  if [ ! -x "$JAVA" ]; then echo "missing native JDK: $JAVA（先跑 provision-jdk.sh）"; exit 1; fi
  cd "$DIR" || exit 1
  nohup "$JAVA" -Xms1G -Xmx2G -jar "$JAR" nogui >"$LOG" 2>&1 &
  echo "starting java pid $!"
  for _ in $(seq 1 45); do
    sleep 2
    if port_open; then echo "world up (native WSL JDK)"; exit 0; fi
  done
  echo "world did not come up; see $LOG"; exit 1
}

stop() {
  pkill -f 'server.jar nogui' 2>/dev/null || true
  echo "world stopped"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) if port_open; then echo "UP"; else echo "DOWN"; fi ;;
  *) echo "usage: wsl-local-world.sh start|stop|status" ;;
esac
