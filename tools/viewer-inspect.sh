#!/usr/bin/env bash
set -u
export PATH="$HOME/opt/node/bin:$PATH"
cd "$HOME/fishbowl/bot" || exit 1
node -e "const v=require('prismarine-viewer'); console.log('keys:', Object.keys(v).join(', ')); for (const k of Object.keys(v)) { console.log(' -', k, typeof v[k]); } console.log('pkg:', require('prismarine-viewer/package.json').version)"
