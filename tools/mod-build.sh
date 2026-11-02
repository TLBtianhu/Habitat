#!/usr/bin/env bash
# WSL 原生模组构建：显式使用沙箱里的 JDK，不继承宿主 PATH
set -euo pipefail
export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk25}"
export PATH="$JAVA_HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
DIR="${1:-$HOME/work/tutorialmod}"
cd "$DIR"
./gradlew build --offline -q
ls -l build/libs
