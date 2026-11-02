#!/usr/bin/env bash
# 下载并启动 MC 26.1 服务端（离线模式，供 bot 连接）
set -u
DIR="$HOME/fishbowl/mc"
mkdir -p "$DIR" && cd "$DIR" || exit 1

if [ ! -s server.jar ]; then
  echo "=== download server.jar (bmclapi) ==="
  curl -fSL --max-time 600 -o server.jar "https://bmclapi2.bangbang93.com/version/26.1/server" || { echo "download failed"; exit 1; }
fi
ls -lh server.jar
python3 - <<'PY'
import zipfile,sys
try:
    z=zipfile.ZipFile('/opt/habitat/fishbowl/mc/server.jar')
    names=z.namelist()[:3]
    print('zip ok, entries', len(z.namelist()), names)
except Exception as e:
    print('not a zip:', e)
PY

echo "eula=true" > eula.txt
if [ ! -f server.properties ]; then
cat > server.properties <<'EOF'
online-mode=false
motd=Fishbowl sandbox world
max-players=8
view-distance=6
simulation-distance=4
spawn-protection=0
enable-command-block=true
difficulty=normal
gamemode=survival
level-name=world
server-port=25565
EOF
fi

echo "=== 启动服务端 ==="
pkill -f 'server.jar nogui' 2>/dev/null
sleep 1
nohup "$HOME/opt/jdk25/bin/java" -Xms1G -Xmx2G -jar server.jar nogui > server.log 2>&1 &
echo "pid $!"
for i in $(seq 1 40); do
  sleep 3
  if grep -q 'Done (' server.log 2>/dev/null; then echo "READY after ${i}x3s"; break; fi
  if grep -qi 'error\|exception' server.log 2>/dev/null; then echo "---- log ----"; tail -20 server.log; break; fi
done
echo "=== log tail ==="
tail -15 server.log
echo "=== listening ==="
ss -lnt 2>/dev/null | grep 25565 || echo "no 25565"
