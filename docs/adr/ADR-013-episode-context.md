# ADR-013：Episode 统一任务上下文与 MemorySlice

> 2026-11-02 · 统一自我与当前任务，分域社交记忆，不把应用开关当记忆生命周期。

## 决定与实现

### Episode

- `Episode` 包含 `id / goal / participants / phase / status / checkpointId / checkpoint / pendingWrites / visibility`；
- 生命周期为 `active ↔ paused → completed/failed/cancelled`，恢复任务不等于新开一个任务；
- `EpisodeStore` 按 episodeId 原子保存，重启恢复 checkpoint、参与者和 pending writes；
- `checkpointState` 保存小型当前任务快照，避免每次写入完整聊天历史；
- `addPendingWrite/confirmWrite` 记录副作用是否真正确认，避免 accepted 被当成成功。

### MemorySlice 与 ContextAssembler

- 当前读取视图由 `core + episode + residence` 组成；
- Episode 只有参与者可以读写，QQ 群/私聊默认看不到无关 Episode；
- `core` 读取共享，写入需要 owner 或明确批准；
- `episode` 写入需要当前 residence 是参与者且 Episode active；
- `residence` 写入明确绑定当前场所，私有来源不跨场所；
- `ContextAssembler` 输出结构化 `core / episode / residence / scopes`，不是简单把所有历史拼成一个长字符串。

### 生命周期与共享

- `app.open/close`、断线、重连只改变 Presence/connectionId，不删除记忆；
- MC 与 B站若属于同一 Episode，可共享当前目标、阶段和已验证事实；
- QQ 群、私聊、B站、MC 的社交记忆仍按 residence 隔离；
- Episode 在 Agent 停机时 pause，重启后 resume。

## 实际验收

- `agent/verify-episode.mjs`：参与者、checkpoint、pending writes、暂停/恢复/结束与重启恢复通过；
- `agent/verify-memory-slice.mjs`：MC+B站共享 Episode、QQ 隔离、core/residence 合并读取、私有记忆和显式写入通过；
- 真实 `live-current` Episode 在 Agent 重启后恢复为 active；
- 既有 ResidenceMemoryStore、Memory、SkillRuntime、PhaseMachine、PluginRegistry、MCP、EventPump、Outbox、ResidencePolicy 回归通过。

## 当前边界

- Episode 目前是结构化任务快照，不是完整图工作流或语义向量记忆；
- 当前 `live-current` 仅声明 system 与 MC 参与者，B站房间需显式加入；
- NapCat 当前因自身登录/协议问题 degraded，不能将其归因于 Episode；
- 后续应把 AfterAction 的已验证事实写入 Episode/SkillLibrary，而不是把未验证的模型叙述写进核心记忆。
