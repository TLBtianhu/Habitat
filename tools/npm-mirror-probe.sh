#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
echo "=== npm 镜像探测（看 mineflayer 的 latest 是否 4.39）==="
for r in https://registry.npmmirror.com https://mirrors.cloud.tencent.com/npm https://mirrors.huaweicloud.com/repository/npm https://registry.npmjs.org; do
  meta=$(curl -sS --max-time 20 "$r/mineflayer" 2>/dev/null)
  if [ -n "$meta" ]; then
    latest=$(node -e "try{const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j['dist-tags']&&j['dist-tags'].latest||'?')}catch(e){console.log('parse-fail')}" <<<"$meta")
    echo "$r -> latest=$latest"
  else
    echo "$r -> unreachable"
  fi
done
