# ADR-010：Owner-approved 跨频道任务与分场所状态

> 2026-11-02 · 跨频道 ControlTask、记忆命名空间和 Presence 聚合。

## 决定与实现

### Owner-approved ControlTask

- `cross_channel.message` 只能由 owner 创建，普通 AI/QQ/B站消息不能直接产生跨频道发送；
- 生命周期：`pending → approved → executing → succeeded/failed`；
- 执行前再次校验目标 residence、`qq.reply` scope、限频和文本；
- 目标只能是明确配置的 `qq.group` / `qq.private`，不能由模型自由指定其他群或用户；
- `CrossChannelTasks` 先查 outbox 再复核限频，重复执行返回旧终态，不会重复发送；
- Control tasks 持久化，outbox 独立保存执行终态。

### 分场所记忆

- `Memory.remember/workingSet/recall` 增加 `scope`，默认只读 `system`；
- QQ 使用 `scope=residenceId`，不同群、私聊、B站和 MC 不共享原始记忆；
- `memoryScope=ephemeral` 的群聊/B站不写长期档案；
- 人格和音色库共享，但记忆检索按 residence 进行。

### Presence 聚合

- `system`、QQ、B站、MC 分别记录 `online/degraded/offline`；
- `ready` = 所有启用场所 online；`degraded` = 至少一个 online 但并非全部；`offline` = 没有 online；
- QQ 离线只影响 QQ，不会把 system 或其他场所标成离线；
- `/presence` 只暴露状态，不包含 token；
- Presence timer 随 Agent 正常停机清理。

## 实际验收

- `control/verify-cross-channel.mjs`：owner 批准、目标复核、幂等、拒绝未批准/跨群/限频通过；
- `control/verify-cross-channel-http.mjs`：真实 Control HTTP 创建/批准/执行、未授权拒绝、重复执行、限频与持久化通过；
- `agent/verify-memory.mjs`：system 默认记忆、residence 隔离读写与 recall 通过；
- `agent/verify-presence.mjs`：分场所状态与 ready/degraded/offline 聚合通过；
- 真实 `/presence`：system/QQ online、MC offline，聚合为 degraded；
- 既有 SkillRuntime 10/10、PhaseMachine 16/16、PluginRegistry、MCP、EventPump、Outbox、ResidencePolicy 回归通过。

## 尚未覆盖

- 跨频道输出目前只支持 QQ，B站/MC 仍需各自输出适配器和主人批准；
- 记忆 scope 目前主要是进程内工作/档案记忆，尚未实现完整的跨重启持久化记忆库；
- Presence 的 `mc.world.current` 是观测健康，不等于 MC 世界已完成完整登录/操作；
- 普通群/私聊默认仍只读，只有主人明确配置的 residence 才允许回复。
