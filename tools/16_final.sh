#!/usr/bin/env bash
cd "$HOME/work/tutorialmod"
echo "=== gradle.properties 代理段（最终） ==="
sed -n '1,14p' gradle.properties
echo
echo "=== 最终离线构建：rm -rf build && ./gradlew build --offline ==="
export JAVA_HOME=/opt/habitat/runtime/jdk25
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"
rm -rf build
S=$(date +%s)
./gradlew build --offline --console=plain 2>&1 | grep -E '^BUILD|actionable|^> Task :(compileJava|jar|neoFormRecompile)'
echo "### FINAL_OFFLINE_EXIT=${PIPESTATUS[0]}  SECONDS=$(( $(date +%s) - S )) ###"
echo
echo "=== 产物 ==="
stat -c '%n | %s bytes' build/libs/*.jar
echo "=== 缓存 ==="
du -sh "$HOME/.gradle" "$HOME/opt/jdk25" 2>/dev/null
echo "=== manifest 内容（neoforge.mods.toml 占位符替换是否生效） ==="
unzip -p build/libs/tutorialmod-1.0.0.jar META-INF/neoforge.mods.toml 2>/dev/null | head -12
echo "=== 原项目目录（只读，未被修改） ==="
ls -la "/mnt/c/mc模组教学/demo/tutorialmod" | head -12
