# ADR-007：稳定 Outbox 与 B 站连接监督

> 2026-11-02 · 持续执行第二阶段：动作终态、迟发结果、B 站真实连接与关闭。

## 决定

### 1. Durable Outbox

- 每个 intent 有稳定 key 和状态：`accepted / running / succeeded / failed / interrupted`；
- 相同 key 已成功只返回旧结果，不重复执行；进行中只返回 `in_progress`，不重复认领；
- 失败和 interrupted 不自动复活、不盲目重试，状态可对账；
- Provider 超时是有界等待，不宣称强杀；实际迟发结果只补记事实并标 `late`，不覆盖正常终态；
- 重启把 accepted/running 标为 interrupted，避免把“曾被接受”误当“已成功”；
- `PluginRegistry` 的工具调用统一经过 outbox，Agent/Broker 与 MCP 共享动作语义。

### 2. B 站 ConnectionSupervisor

- 独立于 AgentLoop 管理 WBI、WSS、连接打开、心跳、超时、重连和停止；
- 指数退避 + jitter，成功 open 后重置退避；
- 连接活动消息（activity）参与心跳，安静直播间不因没有弹幕而被误判死连接；
- 弹幕归一化为 `app.bilibili.danmaku`，处理完成才出队；
- B 站没有可靠全局事件 id，因此只做有限窗口去重，**不宣称 exactly-once**；
- 使用标准 `ws` 包，正常 `close()` 优先，1 秒后有界 `terminate()`，避免“状态 stopped 但进程未退出”。

### 3. 持续运行约束

- 超时测试使用 monotonic clock，防止系统时间跳变误判；
- `/outbox` 与 `/pump` 目录由 Agent 实际用户 tlb3 持有，安装脚本创建并保持所有权；
- 默认不启用 B 站连接，只有显式 `HABITAT_BILIBILI_ROOM_ID` 才进行只读连接；不自动公开推流。

## 实际验收

- `agent/verify-outbox.mjs`：成功去重、进行中拒重入、失败不复活、重启 interrupted、迟发结果补账全部通过；
- `clients/verify-bilibili-supervisor.mjs`：开/关、有限去重、重连、心跳超时和停止通过；
- 真实 B 站只读握手：进入 `ready`，停止后进程正常退出；
- 真实 Agent 对话：outbox 后正常回复，Agent 重启不重复；
- 既有回归：SkillRuntime 10/10、PhaseMachine 16/16、PluginRegistry/MCP、EventPump、AppSession/Compositor/Outlet Supervisor/Control tasks 全部通过；
- 修复了 outbox 目录 root 所有导致的 Agent 写权限错误，并验证持久化恢复。

## 尚未覆盖

- 当前 NapCat 仅 HTTP 可用，QQ WebSocket 监督器尚未接入；
- B 站真实弹幕事件的生产环境验收仅验证了连接握手，事件处理使用可注入假事件验证；
- 跨进程统一动作 outbox 的完全终态对账仍需后续继续完善；
- DSH 原生认知驱动仍未替换当前闭集 Broker。
