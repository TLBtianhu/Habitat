# ADR-024：状态式控制台设置中心

> 2026-11-03 · 设置不是一次性“首次向导”，而是随时可修改、可重新应用的控制台功能。

## 决定

- Windows 客户端新增“设置中心”，owner token 仅在本机内存中使用，不写 Windows 文件；
- `GET /settings` 只返回脱敏配置和生效状态；API key、NapCat token、B站 cookie 永不回显；
- `POST /settings` 先验证 LLM、QQ 后端登录或 B站房间，再原子写入实例配置；校验失败不推进配置修订；
- `POST /settings/reapply` 仅重新应用已保存配置，不读取或覆盖界面中尚未保存的编辑；
- supervisor 监听配置哈希，变更时只重启/停止 AgentLoop，不重启整套基础服务；
- 端口变化要求整实例重启，避免部分进程使用新端口、部分使用旧端口；
- 保存状态、应用状态、配置缺失和进程失败分开显示，不能把 saved 冒充 applied；
- 默认禁用外部应用；MC 通过 local-wsl/windows-host/remote 拓扑配置并验证真实 RPC，未配置时不能启用；B站只读弹幕不等于允许公开推流。

## 实际验收

- 无效 LLM 地址被拒绝且不写配置；
- 有效 LLM 配置保存后，AgentLoop 真实启动；
- 修改模型会重启 AgentLoop；禁用会停止；重新启用和显式 reapply 都会生成新的受控进程；
- 设置 API 未授权返回 403，响应不包含测试 secret；
- 原独立实例共存、幂等启动、崩溃清理和卸载验收继续通过。
