#!/usr/bin/env bash
cd "$HOME/work/tutorialmod"
echo "=== build/ 顶层 ==="
ls -la build/ 2>/dev/null
echo "=== jar 精确时间 ==="
stat -c '%n | %s bytes | mtime=%y' build/libs/*.jar 2>/dev/null
echo "=== 现在时间 ==="
date -Is
echo "=== neoForm 产物位置 ==="
find build -maxdepth 2 -type d -name 'neoForm*' 2>/dev/null | head
echo "=== ~/.gradle 里的 neoform 缓存 ==="
find "$HOME/.gradle" -maxdepth 3 -type d -iname '*neoform*' 2>/dev/null | head
