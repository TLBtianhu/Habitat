#!/usr/bin/env bash
echo "=== JDK ==="
/opt/habitat/runtime/jdk25/bin/java -version 2>&1
du -sh /opt/habitat/runtime/jdk25
echo "=== gradle cache breakdown ==="
du -sh /opt/habitat/.gradle/* 2>/dev/null
echo "=== work dir ==="
du -sh /opt/habitat/work/tutorialmod
echo "=== original project tree (read-only, unchanged) ==="
ls -1 "/mnt/c/mc模组教学/demo/tutorialmod"
echo "=== build log tail (online) ==="
grep -E 'BUILD (SUCCESSFUL|FAILED)|actionable tasks' /opt/habitat/work/build-online.log
