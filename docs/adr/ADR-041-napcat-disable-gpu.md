# ADR-041：无显示环境的 NapCat 禁用 GPU

日期：2026-11-05
状态：Accepted（host 网络与禁用 GPU 后运行验证通过）

## 证据

host 网络消除了登录服务周期性断开后，仍出现账号离线 → NapCat 重启 Worker → GPU 进程退出（`exit_code=15`）→ `GPU process isn't usable. Goodbye.` → QQ `Trace/breakpoint trap`。这解释了此前部分容器退出，不能再用登录态或 Docker 重启策略单独解释。

## 决策

- 使用现有 NapCat 镜像和持久化卷，通过只读 bind mount 提供 `tools/napcat-nogpu-entrypoint.sh`。
- 包装脚本把原 `entrypoint.sh` 复制到容器 `/tmp`，只给 QQ 启动命令增加 `--disable-gpu`，随后执行临时脚本。
- 不修改镜像、原 entrypoint 或 QQ 数据，不把 `hostname` 权限日志当作根因，不删除容器数据。
- 保持 ADR-040 的 host 网络、附着运行、`Restart=no` 和显式 `ExecStop`，避免 GPU 崩溃被自动重启掩盖。

## 验证要求

- 启动日志不再出现 GPU fatal；
- `CheckLoginStatus`、`get_login_info`、`get_status` 和 OneBot WebSocket 均恢复；
- 受控服务重启后仍能恢复，并观察超过此前崩溃间隔；
- 若禁用 GPU 后仍崩溃，保留新日志，不宣称已解决。

最终运行使用 host 网络、禁用 GPU 和固定附着服务，稳定性窗口未再出现 GPU fatal 或登录服务断开；WSL 空闲自动关机禁用后，登录保持 `isLogin=true、coreReady=true`，`get_status` 为 `online=true、good=true`，OneBot 为 ready。
