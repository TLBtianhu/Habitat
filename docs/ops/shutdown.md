# Habitat 正常退出与恢复（稳定发行版）

当前进度、遗留问题与实际关机结果见 [current-status.md](current-status.md)。

> 2026-11-02 · 已实际执行正常停机、WSL 停止、冷启动与数据恢复验证。

## 统一入口

Windows 薄启动器、稳定版关闭按钮和命令行只使用：

```powershell
# 打开 Windows 客户端：WSL 检测、启停和异常恢复共用同一界面
powershell -File tools/win/habitat.ps1 -Action client

# 正常停止 Habitat；不再关闭整个 WSL
powershell -File tools/win/habitat.ps1 -Action stop

# 启动 WSL 与核心服务并做健康检查
powershell -File tools/win/habitat.ps1 -Action start

# 只读健康检查，不改变运行状态
powershell -File tools/win/habitat.ps1 -Action status

# 重新启动并检查恢复情况
powershell -File tools/win/habitat.ps1 -Action resume
```

`start/resume` 不会自动打开 HLS/RTMP，也不会自动公开推流。

## 正常停机顺序

1. **停止新决策**：`habitat-agent` 停止接收新 tick，最多等待当前 tick 5 秒，随后发布 AppSession 快照、暂停并保存当前 Episode、compact 分场所记忆；超时明确报错，不假装成功。
2. **停止出口与适配器**：Outlet Supervisor 停止编码进程并等待真实退出；QQ/B站/MC 适配器由 adapter host 停止；B站与 QQ WebSocket 均正常 close 优先，1 秒后有界 terminate。NapCat 由 `napcat-attached.service` 以固定 `napcat-runtime` 附着运行，原 `napcat` 容器只作为持久化卷源保留。停止时先停 systemd 服务，再对运行容器执行有界 `docker stop`，避免自动重启抵消停止；启动端不创建未命名实例，也不影响其他容器。
3. **停止音频与桌面生产**：Voice、Audio Mixer、Desktop 停止新的合成和捕获，已有磁盘缓存保留。
4. **停止控制面和舞台**：Control、Stage 以及已知旧 Habitat 单元最后退出。
5. **保留 WSL 与其他工作**：Habitat 服务停止后，不执行全局 `wsl --shutdown`；只有使用专用发行版且主人明确选择时，才允许单独终止该发行版。
6. **安装版独立停止**：有 InstallRoot 时只停止该实例的 supervisor 与子进程，不调用开发现实例的 systemctl/wsl-stop，也不停止开发 NapCat；崩溃遗留的已验证子进程按实例 PID 记录清理。

**任何服务停不干净时，报告失败并保留诊断，不强关整个 VM。** Outlet 子进程的超时升级只由 Supervisor 在自己的实例内执行，不能扩大成随意杀进程。

## DSH / 稳定版程序怎么退出

- 先执行上面的 `-Action stop`，再正常关闭 DSH 或稳定版窗口；不需要在任务管理器里强杀。
- 稳定版 Windows EXE 的关闭事件（`WM_CLOSE`、托盘退出、Ctrl+C）应调用同一个 `habitat.ps1 -Action stop`，等待返回后再退出自身。
- DSH GUI 本身不应承担渲染或推流；它退出前只是触发停机，不应另写一套杀进程逻辑。
- 不要在停机时打印 owner token、agent token、RTMP stream key 或完整推流地址。

## 保留的用户数据

- AppSession 快照；
- `system-chat.jsonl` 与 Agent 读取水位；
- `control-tasks.json` 与单调任务 id、批准结果；
- Utterance、TTS 缓存与 VoiceProfile 默认选择；
- Outlet Supervisor 的实例终态和历史；
- 世界存档、配置和凭证。

## 本次实测

- Windows 客户端执行真实停止后，所有 Habitat 单元均为 inactive，NapCat 容器也已停止，WSL 仍保持运行，没有全局关机；
- 客户端再次启动后 `lifecycle.state=running`、`lastShutdownAbnormal=false`、无待恢复项，QQ 恢复 ready；
- 默认音色、聊天水位、任务状态保留；HLS/RTMP 和捕获没有自动重启。

## 发行验收还应覆盖

- 在 LLM tick、TTS 合成、活动捕获和 HLS 编码中分别执行 stop；
- 停到一半再次执行 stop，必须幂等；
- 注入停止超时，必须报告并保留诊断，不能假装全部正常；
- 直接断电后的下一次 start 能恢复，但不得把断电称为“正常退出”；
- 更新应用层后，上述用户数据仍保留。
