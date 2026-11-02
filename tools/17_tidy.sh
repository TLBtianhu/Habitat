#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/work/tutorialmod"

# 把之前追加到文件末尾的 nonProxyHosts 行删掉，重新放到代理四行后面
sed -i '/^systemProp\.http\.nonProxyHosts=/d' gradle.properties
sed -i '/^# mojang 的 piston-meta 走代理不稳/d; /^# 所以绕过代理/d' gradle.properties
# 在 https.proxyPort 行后插入带注释的 nonProxyHosts
python3 - <<'PY'
import io
p = "gradle.properties"
s = io.open(p, encoding="utf-8").read()
anchor = "systemProp.https.proxyPort=7897\n"
add = ("# piston-meta.mojang.com 走代理会 TLS 重置（而直连很快），所以把它排除在代理外；\n"
       "# services.gradle.org 同理（wrapper 下载已在直连下验证可用）。\n"
       "systemProp.http.nonProxyHosts=piston-meta.mojang.com|*.mojang.com|localhost|127.0.0.1\n")
assert anchor in s
s = s.replace(anchor, anchor + add, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
PY

echo "=== gradle.properties 前 16 行 ==="
sed -n '1,16p' gradle.properties

echo
echo "=== 在线构建最终验证 ==="
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"
S=$(date +%s)
./gradlew build --console=plain 2>&1 | grep -E '^BUILD|actionable|What went wrong|Could not' 
echo "### ONLINE_FINAL_EXIT=${PIPESTATUS[0]}  SECONDS=$(( $(date +%s) - S )) ###"
echo "=== jar ==="; stat -c '%n | %s bytes' build/libs/*.jar
