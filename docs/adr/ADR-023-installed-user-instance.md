# ADR-023：安装版独立用户实例与 Windows 启停接入

> 2026-11-03 · 安装版不再借用开发现实例的 systemctl 服务或数据目录。

## 决定

- 安装版由 WSL 当前用户运行 `tools/instance-supervisor.mjs`，不依赖系统级 systemd，也不要求 root；
- 默认路径为 `$HOME/.local/share/habitat/{app,runtime,data,config}`，与开发 `/opt/habitat` 和便携版分离；
- 默认端口为 Control 10240、Desktop 10260、Voice 10270、Audio 10271、Outlet 10272、Stage 10230；开发实例继续使用 92xx；
- Windows 客户端从注册表/InstallRoot 选择实例：安装实例走 supervisor，现用实例继续走 systemctl 与 NapCat；
- 启动前读取 supervisor 状态，运行中只做健康检查，不重复 boot、不重复拉起进程；
- 停止只向已验证属于本实例的 supervisor/子进程发 SIGTERM，超时仅处理该子进程，不执行全局 WSL 关机；
- supervisor 崩溃后保留 recovery_required，stop 可按持久化 PID 和 app 路径清理孤儿进程；
- 默认禁用 QQ/B站/MC 外部连接；没有 `config/llm.json` 时标记 `configuration_required=["llm"]`，不启动必失败的 AgentLoop，也不声称人格在线；
- 不自动启动 HLS/RTMP 或公开推流。

## 跨平台发行修复

- Windows 构建的应用包可能含 Windows 原生依赖；WSL 安装后必须使用随实例安装的 Node/npm 按 lockfile 执行 `npm ci`，取得 Linux 可选依赖；
- runtime 归档在正式 data 目录保留，供升级复用；app/runtime 切换失败仍恢复旧版本；
- owner/agent/NapCat/mcpfabric token 在各实例 config 中独立生成，不复制开发实例凭证。

## 实际验收

- 真实安装后，独立 102xx 端口健康，HLS 关闭，外部应用禁用，缺 LLM 明确标记；
- 重复启动幂等，不产生第二套进程，也不误写异常关机；
- 现用 9240 实例与 QQ 保持 ready，安装实例启停不影响它；
- 杀死测试 supervisor 后，状态为 recovery_required，stop 清理孤儿，随后可重新启动并正常停止；
- Setup EXE 安装、平台依赖安装、回滚和卸载保留 data/config 全部通过。
