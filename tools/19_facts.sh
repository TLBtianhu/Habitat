#!/usr/bin/env bash
# 汇总最终状态，写入报告用的事实清单
cd "$HOME/work/tutorialmod" || exit 1
export JAVA_HOME=/opt/habitat/runtime/jdk25
{
  echo "java:    $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
  echo "javac:   $("$JAVA_HOME/bin/javac" -version 2>&1)"
  echo "jdksize: $(du -sh "$JAVA_HOME" | cut -f1)"
  echo "gradle:  $(cat gradle/wrapper/gradle-wrapper.properties | grep distributionUrl)"
  echo "jar:     $(stat -c '%n %s bytes' build/libs/*.jar)"
  echo "gradlecache: $(du -sh "$HOME/.gradle" | cut -f1)"
  echo "workdir: $(du -sh "$HOME/work/tutorialmod" | cut -f1)"
} | tee "$HOME/work/facts.txt"
