# ADR-040：NapCat 使用 WSL Host 网络恢复 QQ 登录服务

日期：2026-11-05
状态：Accepted（host 网络下登录与 OneBot 证据通过）

## 背景

ADR-039 解决了附着运行和受控停止，但 Docker bridge 下仍出现周期性 `登录服务已断开`、`Login Error ErrType=1、ErrCode=1`，随后进入 `waiting_qrcode`。容器启动时间不变，说明这不是进程重启本身。

## 对照实验

使用同一镜像、同一持久化卷和同一登录数据，仅把运行网络从 Docker bridge 改为 WSL host：

- 不需要重新刷新二维码；
- `CheckLoginStatus` 返回 `isLogin=true、coreReady=true`；
- OneBot `get_status` 返回 `online=true、good=true`；
- `get_login_info` 返回真实账号。

这支持登录服务断开与 Docker bridge 网络路径有关的判断，不把 hostname 或 GPU 日志未经证据地认定为根因。

## 决策

- `napcat-runtime` 使用 `--network host`，不再通过 Docker 端口映射转发 QQ 原生协议流量。
- 保留 `--volumes-from napcat`、`Restart=no`、显式 `ExecStop` 和受控日志文件。
- OneBot HTTP 直接使用容器的 3001；Agent 通过独立 `onebot-host-network.conf` 设置 `HABITAT_ONEBOT_HTTP_URL=http://127.0.0.1:3001`。
- OneBot WebSocket 仍为 3002，NapCat WebUI 仍为 6099。
- 安装器仅在 host 网络单元存在时部署该 HTTP 覆盖，旧 bridge 安装不被强制改写。

## 验证边界

必须同时验证真实登录、OneBot online/good、WebSocket ready 和受控重启后的恢复；不能只因 host 网络进程启动就宣称长期网络稳定。观察期间若再次出现登录服务断开，应记录真实原因，不通过反复刷新二维码掩盖。

受控 `systemctl restart napcat-attached.service` 后，容器使用 host 网络重新启动，未重新要求二维码，`isLogin=true、coreReady=true`、`online=true、good=true`，Agent 环境明确使用 `HABITAT_ONEBOT_HTTP_URL=http://127.0.0.1:3001`。此前 bridge 下约一分钟一次的登录服务断开，在 host 网络观察窗口内未再出现。
