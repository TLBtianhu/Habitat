# ADR-012：AfterAction 自我复盘与证据验收

> 2026-11-02 · 自我感受与客观验证分离，证据不足只能 unknown。

## 决定与实现

- `agent/after-action.mjs` 提供 `AfterActionStore` 和 `verifyChecks`；
- `selfReport` 与 `verification` 分开保存：模型可以描述顺利/受阻，但不能据此改变客观终态；
- 没有检查项或证据缺失只能 `unknown`；必需检查失败为 `verified_failure`，全部必需检查通过才为 `verified_success`，可选检查失败为 `verified_partial`；
- 只有 `verified_success` 才允许后续记忆写入，失败/unknown/partial 不自动写入长期经验；
- 报告带 `taskId/residenceId/goal/selfReport/verification/createdAt`，默认脱敏，按 residence 查询；
- `CrossChannelTasks` 在目标拒绝、限频、执行失败和成功时均记录 AfterAction，重复执行不重复记录。

## 实际验收

- `agent/verify-after-action.mjs`：自评与验证分离、缺证据 unknown、失败不可覆盖、residence 隔离与脱敏通过；
- `control/verify-cross-channel.mjs`：成功复盘不重复，策略拒绝也有 verified_failure；
- `control/verify-cross-channel-http.mjs`：成功、限频失败、目标失败与私聊成功均有独立复盘；
- 既有 SkillRuntime、PhaseMachine、PluginRegistry、MCP、EventPump、Outbox、ResidenceMemoryStore 回归通过。

## 当前边界

- 当前已支持 `selfReport` 字段，但**尚未强制每次由模型生成自评**；现有验收首先是证据驱动，不让模型自评成为成功依据；
- 后续可在任务结束生成一句简短自评，再做同样的证据校验；
- 下一批接入目标是 `voice.speak` 与 `outlet.start/stop`，要求音频 hash/ready 和帧新鲜度/真实退出证据。
