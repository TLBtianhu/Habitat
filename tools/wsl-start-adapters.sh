#!/usr/bin/env bash
# Habitat 启动适配器：附着服务使用固定运行容器和原持久化卷；旧安装仅启动已有容器。
set -euo pipefail
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ -n "$(docker ps -aq --filter 'name=^/napcat$')" ]; then
    if [ -f /etc/systemd/system/napcat-attached.service ]; then
      env_file=/opt/habitat/state/napcat-runtime.env
      if [ ! -s "$env_file" ]; then
        account="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' napcat | sed -n 's/^ACCOUNT=//p' | head -n1)"
        if [ -n "$account" ]; then
          (umask 077; printf 'ACCOUNT=%s\n' "$account" > "$env_file")
        fi
      fi
      if [ ! -s "$env_file" ]; then
        echo 'NapCat ACCOUNT is not configured in the existing container' >&2
        exit 1
      fi
      chmod 600 "$env_file"
      systemctl start napcat-attached.service
    else
      docker start napcat >/dev/null
    fi
  fi
fi
