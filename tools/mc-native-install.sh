#!/usr/bin/env bash
set -euo pipefail
DIR=/opt/habitat/app/mc-native
mkdir -p "$DIR"
cat > "$DIR/launcher_profiles.json" <<'EOF'
{"profiles":{"fabric":{"name":"Fabric 1.21.4"}}}
EOF
/opt/habitat/runtime/jdk25/bin/java -jar "$DIR/fabric-installer.jar" client -dir "$DIR" -mcversion 1.21.4
