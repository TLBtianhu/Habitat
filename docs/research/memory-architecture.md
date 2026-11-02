# 统一自我、Episode 状态与分域记忆：开源架构调研

> 2026-11-02 · 目标：避免“每个应用一个孤立脑子”，同时避免把所有历史无差别塞进一个上下文。

## 1. 开源项目实际采用的结构

| 项目 | 核心做法 | 对 Habitat 的启示 |
|---|---|---|
| **LangGraph** | `thread_id + checkpoints` 保存每一步状态，用于恢复、时间旅行、pending writes；另有跨线程 `Store` 保存长期数据 | Episode 状态与长期记忆必须分开；应用开关不是记忆生命周期 |
| **CrewAI** | 统一 Memory 下有层级 scope、slice、source/private、合并去重、读写屏障 | 私有上下文和共享知识可以组合读取，但写入必须显式指定 scope；跨域只读视图很有价值 |
| **AutoGen** | Agent 自己 `save_state/load_state`，Team 也保存所有成员状态；reset 后未保存的历史会丢失 | 单 Agent 记忆和团队任务状态分开，任务状态需要显式保存/恢复 |
| **Voyager** | 自动课程、可执行技能库、环境反馈/错误/自验证、checkpoint 恢复 | 经验应是可复用技能和已验证事实，不是原始聊天记录；技能可跨任务/世界复用 |
| **Letta** | core memory、shared memory、archival memory、context hierarchy；共享 block 可附加到 Agent | 核心自我是小而稳定的上下文，长期档案通过受控检索进入，共享 block 应显式授权 |
| **OpenHands** | conversation/workspace 状态随后端持久化；不同容器隔离执行，共享 workspace 才共享文件 | 共享工作区不等于共享所有记忆；场所隔离和任务状态要分别定义 |

## 2. 最重要的两个分离

### A. Episode/Thread 状态 ≠ 长期记忆

LangGraph 的 checkpoint 是“执行到哪一步、哪些结果已提交、哪些写入 pending”，不是简单的长期档案。

Habitat 应把它映射为：

```text
Episode E1
  goal: 在 MC 世界 X 生存并直播
  phase: PLAY
  participants: [mc.world.X, bilibili.room.Y]
  checkpoint: third attempt started
  pendingWrites: [HLS stop 尚未确认]
```

MC 和 B站可以共享这个 Episode 的任务状态，即使它们不是同一个应用。

### B. 共享读取 ≠ 共享写入

CrewAI 的 `scope` 限制一个子树，`slice` 可以把多个分支合并成读取视图，且可以只读。这个正适合大肥鱼：

```text
当前读取视图 =
  core（只读）
+ episode:E1（按参与者读写）
+ residence:当前 QQ 群/直播间（按本地策略读写）
```

但不能让模型自由把内容写到 core 或其他 residence。写入必须指定目标 scope，并重新检查权限。

## 3. 推荐 Habitat 记忆分层

### CoreMemory（统一自我）

- 人格、音色库、长期授权、稳定偏好、已验证的长期事实；
- 小而稳定，不存原始闲聊；
- 全局共享，但核心写入需要 owner 或验证流程。

### EpisodeMemory（统一当前任务）

- `episodeId`、目标、阶段、参与者、当前 checkpoint、pending writes、可见性；
- 按任务开始/暂停/恢复/结束管理，不按 app.open/close 管理；
- 允许 MC+B站、MC+system 等明确参与者共享；
- 只共享任务相关事实，不共享 QQ 私聊或无关社交内容。

### ResidenceMemory（分域社交经验）

- QQ 群/私聊、B站房间、MC 世界的社交上下文、黑话、偏好、局部约定；
- 保留独立 TTL、隐私和读取策略；
- 群/B站原始内容默认 ephemeral，私聊才可有期限保存。

### SkillLibrary（可复用经验）

- 由 AfterAction 验证成功的行为模式、故障恢复策略、已验证工具用法；
- 类似 Voyager 的技能库，跨任务/世界复用；
- 不执行任意生成代码，仍走 Habitat 闭集动作和 PhaseMachine。

## 4. 记忆周期应该这样定义

| 层 | 生命周期 | 是否跨场所 |
|---|---|---|
| Turn | 当前动作/观测，秒到分钟 | 仅当前 turn |
| Episode | 任务开始→完成/失败/取消，可暂停/恢复 | 按参与者共享 |
| Residence | 按社交上下文和 TTL 保存，独立于应用开关 | 默认不共享 |
| Core | 长期、可验证、可撤回 | 全局共享 |
| Connection/AppSession | 连接/应用运行期间 | 只影响 Presence，不决定记忆寿命 |

**应用关闭不是记忆删除，应用开启也不是记忆开始。**

## 5. MC + B站的正确上下文示例

```text
Episode E1:
  目标：MC 世界 X 生存并直播
  当前任务：第三次收集木头
  当前阶段：PLAY
  已知事实：前两次失败原因已验证
  当前出口：HLS stopped

B站观众问“现在怎么样了”：
  读取 core + E1 + 当前 B站社交上下文
  不读取 QQ 私聊或其他群的私人内容
```

B站能理解当前 MC 任务，因为 E1 是共同任务；但不会因此获得其他场所的全部记忆。

## 6. 需要避免的抄袭式误区

- 不像 LangGraph 那样每一步都保存完整大历史：Habitat 应保存小型结构化 Episode 快照和增量 writes，避免状态膨胀；
- 不让 LLM 自动决定所有 scope：CrewAI 可推断 scope，但 Habitat 涉及隐私，默认必须确定性分配；
- 不把 AutoGen 的 team state 当成所有应用的全部状态：只把明确参与当前 Episode 的场所纳入；
- 不让 Voyager 式技能变成任意代码执行：技能仍编译成闭集 intent 和受控恢复；
- 不把共享 memory block 当默认公共区：跨场所共享必须有来源、可见性和批准。

## 7. 推荐下一步实现

1. `Episode`：episodeId、目标、阶段、参与者、开始/暂停/恢复/结束、checkpoint；
2. 记忆项增加 `episodeId / visibility / source / private / checkpointId`；
3. `MemoryScope + MemorySlice`：当前 turn 可读 core+episode+当前 residence，写入必须显式目标；
4. `ContextAssembler`：人格 + 当前 Episode + 当前 residence 工作集 + 允许检索的事实；
5. AfterAction 只把验证事实写入 Episode/SkillLibrary；
6. 验收：MC+B站共享 Episode、群间隔离、关闭后恢复、pending writes 恢复、私聊不泄漏、结束归档。

## 参考链接

- LangGraph Checkpointers：https://docs.langchain.com/oss/python/langgraph/checkpointers.md
- LangGraph Stores：https://docs.langchain.com/oss/python/langgraph/stores.md
- LangGraph Add Memory：https://docs.langchain.com/oss/python/langgraph/add-memory.md
- CrewAI Unified Memory：https://docs.crewai.com/v1.15.34/en/concepts/memory
- AutoGen Managing State：https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html
- Voyager：https://github.com/MineDojo/Voyager
- Letta Memory/Shared Memory：https://docs.letta.com/v1-sdk/memory/memory-blocks/ 、https://docs.letta.com/v1-sdk/memory/shared-memory/
- OpenHands：https://github.com/OpenHands/OpenHands
