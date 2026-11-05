# NapCat 附着运行与登录恢复

日期：2026-11-05

## 实测现象

同一镜像、同一账号配置和同一持久化数据下，后台 `docker start` 曾以 `255` 退出；新建附着运行容器后，WebUI、`get_login_info` 和 OneBot WebSocket 可以稳定工作。登录二维码过期只解释需要重新登录，不能单独解释容器退出。

## 运行方式

- 原 `napcat` 容器保留为持久化卷源和回滚证据，不要求它以后台方式运行。
- `napcat-attached.service` 使用固定名称 `napcat-runtime`，通过 `--volumes-from napcat` 复用原数据，以 WSL host 网络附着运行，避免 Docker bridge 的登录服务断开。
- OneBot HTTP 使用 `127.0.0.1:3001`，WebSocket 使用 `127.0.0.1:3002`，WebUI 使用 `127.0.0.1:6099`；Agent 由 `onebot-host-network.conf` 读取 HTTP 地址。
- 无显示环境通过只读 bind mount 的 `napcat-nogpu-entrypoint.sh` 给 QQ 增加 `--disable-gpu`，只修改容器临时启动脚本，避免 Worker 重启时 GPU fatal；不改镜像或持久化数据。
- 账号运行参数由启动脚本从现有容器生成到 `/opt/habitat/state/napcat-runtime.env`（0600），公开单元不包含账号或令牌。
- 运行容器退出时自动清理自身，不删除原容器或数据卷；服务启动前只清理同名运行容器，避免重复端口占用。
- `Restart=no`，意外退出进入明确的 failed 状态，不用自动重启掩盖故障；`--rm` 负责正常退出时清理运行容器。若异常留下同名运行容器，只清理 `napcat-runtime`，不得删除原 `napcat` 或数据卷。
- `ExecStop=-/usr/bin/docker stop --timeout 15 napcat-runtime`，受控停止/重启时先清理旧运行容器，避免 CLI 停止后旧容器占用名称和端口。
- 正常停止使用 `systemctl stop napcat-attached.service`，随后由 `wsl-stop.sh` 对 `napcat-runtime` 执行有界停止；不要直接 `docker restart`。

```bash
systemctl status napcat-attached.service
systemctl start napcat-attached.service
systemctl stop napcat-attached.service
journalctl -u napcat-attached.service -n 80 --no-pager
```

## VM 空闲自动关机

本次反复“容器重启”的根因证据指向 WSL 空闲关机：`journalctl --list-boots` 显示 VM 多次重启，上次关机日志包含 `systemd poweroff` 和 WSL 超时强制断电。Habitat 需要持续运行时，在 `%UserProfile%\.wslconfig` 保留其他设置并增加：

```ini
[wsl2]
vmIdleTimeout=-1

[general]
instanceIdleTimeout=-1
```

该全局设置会影响所有 WSL2 实例，修改前保留备份。它不会禁止 Owner 的正常停止或显式 `wsl --shutdown`。详见 [ADR-042](../adr/ADR-042-wsl-idle-timeout.md)。

## 恢复验收

必须分别验证：

1. WebUI 的 `CheckLoginStatus` 返回真实登录态；
2. OneBot `get_login_info` 返回 `retcode=0`；
3. OneBot `get_status` 返回 `online=true、good=true`；
4. Agent 的 `/qq/status` 返回 `state=ready` 且有实际连接时间。

本次恢复还完成了受控 `systemctl restart napcat-attached.service`：旧 `napcat-runtime` 被清理，新容器使用 host 网络启动，未重新要求二维码，重新获得 `online=true、good=true` 和 OneBot ready；继续观察未再次退出。

只读检查不得输出 WebUI Token、OneBot Token、二维码 URL 或 Owner Token。原容器和持久化卷备份在恢复期间保留，不以清空数据作为修复手段。登录 ready 不是永久状态；出现 `auth_required` 时必须重新认证，不能把上次 ready 当成当前连接证明。
