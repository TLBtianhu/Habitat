#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
curl -sSL --max-time 40 -o /tmp/v26.json "https://bmclapi2.bangbang93.com/version/26.1/json" || { echo "json failed"; exit 1; }
node -e "
const j=require('/tmp/v26.json');
const s=j.downloads&&j.downloads.server;
console.log('server_url=' + (s?s.url:'none'));
console.log('size=' + (s?s.size:0));
console.log('java=' + (j.javaVersion?j.javaVersion.majorVersion:'?'));
" 2>&1
