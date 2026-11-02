#!/usr/bin/env bash
# WSL 用户态 Identity Hub
set -euo pipefail
export PATH="/opt/habitat/runtime/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export FB_IDENTITY_ROOT=/opt/habitat/app/identity
export FB_IDENTITY_STORE=/var/lib/habitat/identities.json
cd /opt/habitat/app
exec node identity/hub.mjs >>/var/lib/habitat/logs/identity.log 2>&1
