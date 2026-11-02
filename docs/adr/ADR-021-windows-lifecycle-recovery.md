# ADR-021：Windows 客户端统一生命周期与异常恢复

> 2026-11-03 · 主人只看到 Windows 客户端，WSL 是实现细节，不再需要手工拼启停命令。

## 实现

- `tools/win/client.ps1` 提供 WinForms 控制台：WSL 检测、启动、停止、状态刷新和异常恢复；
- `tools/win/lifecycle.psm1` 固定 WSL 命令白名单，Node 路径从 Habitat ExecStart 动态解析；
- 启动顺序为 WSL/keepalive → lifecycle boot → 核心服务 → 健康检查 → ready；
- 停止顺序为 stopping → 优雅停服务 → stopped，**不执行全局 `wsl --shutdown`**；
- `control/recovery.mjs` 持久化启动次数、正常/异常停止和恢复状态；
- `GET /lifecycle` 返回真实状态，`POST /recovery` 只允许 owner token；
- 恢复先读取已有 AfterAction 报告并合并重复 intent，不重放动作；pending/unknown 仍需后续只读证据；
- root 执行恢复时，Lifecycle、Episode 和 SkillLibrary 文件继承数据目录的服务账号所有权。

## 实际验收

- 离线覆盖 WSL 未启动、正常启停、停止失败、异常恢复和禁止全局关机；
- Control HTTP 验证未授权 403、owner 恢复和 pending 清理；
- Windows 客户端真实停止后，所有 Habitat 服务为 inactive，WSL 仍运行；
- 再次启动后 `state=running`、`lastShutdownAbnormal=false`、无待恢复项，QQ 恢复 ready；
- WinForms 脚本只做语法验收，未由自动化控制宿主显示或输入。

## 边界

- 关闭 Windows 窗口不会自动停止 Habitat，必须显式点击“停止 Habitat”；
- 不自动启动 HLS/RTMP 或公开推流；
- 不把异常关机称为正常退出，不承诺绝对零数据丢失；
- 只有专用发行版且主人明确选择时，才考虑单独终止该发行版，不影响其他 WSL 工作。
