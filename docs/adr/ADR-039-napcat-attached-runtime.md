# ADR-039：NapCat 附着运行与显式停止边界

日期：2026-11-05
状态：Accepted（登录、OneBot、受控重启与持续运行验证通过）

## 背景

原 NapCat 容器后台 `docker start` 会以 255 退出，Docker 自动重启又不断覆盖现场。登录二维码过期需要重新扫码，但登录成功并不能解释所有容器退出。

## 实测

- 使用同一镜像、账号配置和持久化卷，新建附着运行容器可以进入登录界面并保持运行。
- 用户完成扫码后，`get_login_info` 返回真实账号，`get_status` 返回 `online=true、good=true`。
- 只停止 `docker run` 的 CLI 而不停止容器，会导致受控重启时旧容器仍存在，新容器以名称冲突 125 失败。
- 最小化服务配置后，保留附着运行、文件日志、显式停止，去掉预清理和自动重启，运行容器可以稳定工作。

## 决策

### 运行与数据分离

- 原 `napcat` 容器保留为持久化卷源和回滚证据，不再要求它后台运行。
- `napcat-attached.service` 使用固定 `napcat-runtime`，通过 `--volumes-from napcat` 复用原数据。
- 运行容器使用 `docker run --rm` 附着启动；退出时清理运行容器，不删除原容器或数据卷。账号等运行参数放在 `/opt/habitat/state/napcat-runtime.env`（0600），由启动脚本从现有容器配置生成，不写入公开单元。

### 启停边界

- `Restart=no`：意外退出进入 failed，不能用无限重启掩盖故障。
- `ExecStop=-/usr/bin/docker stop --timeout 15 napcat-runtime`：停止或重启时先清理旧运行容器，避免名称冲突和多个 QQ 实例。
- `TimeoutStopSec=45`，停止有界；输出写入受控日志文件，不依赖调试会话。
- `wsl-start-adapters.sh` 优先启动 systemd 服务；`wsl-stop.sh` 先停止服务，再对运行容器执行有界停止。
- 安装流程部署服务单元，但不在没有配置容器时自动创建或启动 NapCat。

## 验证

- `get_login_info`：`retcode=0`。
- `get_status`：`online=true、good=true`。
- Agent `/qq/status`：`state=ready`，有真实连接时间，`pending=0`、`deadLetter=0`。
- 受控 `systemctl restart napcat-attached.service` 后重新获得上述证据。
- 受控重启后继续观察，运行容器启动时间保持不变，服务为 enabled/active，`ExecMainStatus=0`。

这证明当前启动与停止方式可用，不把 `hostname` 权限错误或 GPU 初始化日志未经证据地认定为唯一根因，也不把容器 running 单独当作 QQ 在线证明。
