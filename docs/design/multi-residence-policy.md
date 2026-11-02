# 多场所人格与频道策略（Multi-Residence Policy）

> 2026-11-02 · 参考 NoneBot、LangBot、AstrBot、MaiBot 的公开设计。
> 核心：**大肥鱼是同一个人，但 QQ 不是她唯一的家。人格共享，场所隔离。**

## 1. 三个层次不能混

| 层次 | 含义 | 是否共享 |
|---|---|---|
| Persona（人格） | 大肥鱼的身份、表达方式、音色库、长期价值观 | 跨场所共享 |
| Residence（场所） | 系统控制台、某个 QQ 群、某个 QQ 私聊、某个 B 站房间、某个 MC 世界 | 每个场所有独立策略和状态 |
| Channel（协议） | OneBot、B站 WSS、mcpfabric、Control HTTP | 只负责输入/输出，不决定人格和权限 |

QQ 群是 residence，不是 Habitat 本身；NapCat 连接是 channel，不是主人身份；`connectionId` 是临时连接代数，不能当 residence id。

## 2. 每个事件必须先绑定 ResidenceContext

```jsonc
{
  "residenceId": "qq.group.<groupId>",
  "channel": "qq",
  "kind": "group",
  "selfId": "<机器人账号>",
  "peerId": "<群或私聊对象>",
  "speakerId": "<发言者>",
  "speakerRole": "viewer",
  "connectionId": 1,
  "addressed": false,
  "trust": "viewer"
}
```

规则：

- `residenceId` 跨重连/重启稳定，`connectionId` 只用于诊断；
- `speakerId ≠ selfId` 才是外部发言者，自己的消息不进入回复队列；
- `speakerRole` 由“场所 + 主人 allowlist + 频道类型”共同决定；
- 群主/管理员不自动成为 Habitat owner；同一个人在系统控制台可以是 owner，在普通群里仍按该群策略处理；
- `addressed` 必须由 @、回复机器人、明确称呼或私聊上下文计算，不能由模型猜。

## 3. 默认策略矩阵

| 场所 | 输入 | 回复 | 主动发言 | 工具 | 记忆 |
|---|---|---|---|---|---|
| `system` 控制台 | owner 直接对话 | 允许 | 按现有 Initiative | 闭集系统/语音/应用动作 | 可持久化、可检索 |
| `qq.private` 私聊 | allowlist 用户 | 允许但限频 | 默认关闭 | 只允许 `qq.reply`，其他工具显式批准 | 私聊独立，默认不读其他场所 |
| `qq.group` 群聊 | 普通消息/弹幕 | 仅 addressed | 默认关闭 | 只允许 `qq.reply`，不允许系统/文件/Shell/Outlet | 默认短期，不写长期记忆 |
| `bilibili.room` 直播间 | 普通弹幕 | 按直播策略 | 默认关闭 | 直播输出，无系统工具 | 默认短期，不进入私人记忆 |
| `mc.world` 游戏世界 | 世界 obs/玩家聊天 | 世界内回应 | 按 Phase 和主动行为预算 | 仅当前世界的闭集动作 | 世界独立，不读 QQ 私聊 |

**普通 QQ/B站消息永远是不可信输入，不是主人指令。**

## 4. 回复路由必须绑定来源，不能由模型自由选目标

```text
事件 → ResidenceContext → 策略门 → 有界 Agent turn
     → channel.reply → 再次策略校验 → outbox → 原场所输出
```

- `system.say` 只能回 `system`；
- `qq.reply` 只能回产生该消息的 `residenceId`；
- `mc.say` 只能回当前世界；
- B站输出只能回当前直播场所；
- 模型不得直接提供任意 `groupId/userId/roomId` 来跨场所发送；
- 若主人明确要求“去另一个场所说一句话”，必须建立 owner-approved `ControlTask`，记录来源、目标、内容、批准和执行终态，不能从普通消息推断。

## 5. 记忆策略：人格共享，记忆不串场

### 共享

- 人格、音色库、公开事实、主人明确允许共享的偏好；
- 共享内容必须带 `sourceResidenceId` 和审核状态。

### 隔离

```text
memory://system/...
memory://qq/private/<userId>/...
memory://qq/group/<groupId>/...
memory://bilibili/<roomId>/...
memory://mc/<worldId>/...
```

- 群聊/B站原始消息默认只保留短期上下文，不自动写长期记忆；
- QQ 私聊记忆不进入群聊、B站或 MC；
- 群 A 的黑话/气氛不自动带到群 B；
- 跨场所检索需要主人批准或显式共享规则；
- 音色库共享，但每个 residence 可有独立默认 VoiceProfile，不能由普通消息改变。

## 6. 回应、限频与主动行为

### 建议起步值（可配置，不是平台硬规则）

- QQ 群：仅 addressed 才回复；每群最多 1 条/5 秒，队列 50，超限显式 dead-letter；
- QQ 私聊：每条可答，最多 1 条/2 秒，仍使用同一 residence outbox；
- 主动发言：所有非 system 场所默认关闭，需按 residence 单独开启 quiet-hours、频率和额度；
- 一个热门群不能耗尽全局 LLM/语音预算，按 residence 限制并发；
- LLM 长 turn 不阻塞 QQ 心跳、其他群、系统控制台或 MC 事件接入。

## 7. Presence 与 Phase

- QQ 离线只表示 `qq` residence degraded/offline，不能把大肥鱼整体标成离线；
- `/qq/status`、`/pump/status`、MC、B站分别诊断，不能互相代替；
- 普通 QQ 消息不能触发 `app.open/close`、推流、Outlet、CODE/PLAY 切换；
- AppSession 记录 QQ 的打开/关闭，不影响 system.chat 和其他应用继续存在。

## 8. 开源做法对应的借鉴

- **NoneBot**：适配器负责平台事件/API 转换，Permission/Rule 负责筛选；参考其“先权限、再处理”和持续生效的权限语义。链接：[Adapter](https://nonebot.dev/docs/advanced/adapter)、[Permission](https://nonebot.dev/docs/appendices/permission)。
- **LangBot**：多平台、访问控制、限频、敏感过滤、多 Pipeline；借鉴其按场景分 Pipeline 和监控，而不是一个全局群聊循环。链接：[LangBot](https://github.com/langbot-app/LangBot)。
- **AstrBot**：多 IM 平台接入，危险代码/Shell 另设 Agent Sandbox；借鉴“普通聊天与高风险执行分域”。链接：[AstrBot](https://github.com/AstrBotDevs/AstrBot)、[Agent Sandbox](https://docs.astrbot.app/use/astrbot-agent-sandbox.html)。
- **MaiBot**：多人对话中的气氛、何时开口/闭嘴、群聊风格和记忆；借鉴其非机械问答，但主动行为必须按 residence 限额。链接：[MaiBot](https://github.com/Mai-with-u/MaiBot)。

## 9. 落地顺序

1. 引入 `ResidenceContext` 与 `ChannelPolicy`，不再只按 `channel=qq` 判断；
2. 输入门：allowlist、addressed、限频、记忆权限、工具权限；
3. 输出门：`channel.reply` 绑定来源 residence，禁止模型自由跨场所；
4. 记忆命名空间与 presence 聚合；
5. 再开放受限 QQ 输出，普通默认仍保持只读。

## 10. 必须通过的测试

- 同一句话在两个群产生独立上下文和独立回复目标；
- 未 addressed 的群消息不回复，addressed 只回来源群；
- 群主/管理员不自动获得 owner 权限；
- 同一人在 system 是 owner，在普通群仍按该群策略；
- QQ 消息不能进入 system.chat、MC 或其他群；
- QQ 离线不影响 system/MC；
- 重连保留 residenceId，connectionId 改变；
- 群记忆不串到另一群/B站/MC；
- 自己的消息、重试和重启不重复回复；
- 跨场所发言必须有 owner-approved ControlTask。

## 11. 当前实现状态

- `agent/residence-policy.mjs` 已实现 ResidenceContext、owner/trusted/viewer、addressed、限频、记忆作用域和回复授权；
- OneBot 归一化事件携带 `residenceId/peerId/speakerRole/addressed/allowedToRespond`；
- `qq.reply` 已加入插件注册表，目标由策略绑定，outbox 负责幂等；
- 每轮最多处理一个 QQ residence，避免跨群/私聊串上下文；
- 非 system 来源禁止直接 `system.say/voice.speak/mc.say`，跨频道需要 owner-approved ControlTask；
- “群聊A”已按主人配置开启 addressed 回复并完成真实自动回复验收，其他群和私聊仍默认只读；
- `cross_channel.message` 已实现 owner 创建/批准/执行、目标复核、outbox 幂等与任务持久化；
- `ResidenceMemoryStore` 已提供按 residence 的 JSONL 持久化、TTL、脱敏、重启恢复和 owner-approved 共享，见 [ADR-011-residence-memory-store.md](../adr/ADR-011-residence-memory-store.md)；
- `AfterActionStore` 已将自评与证据验证分离，跨频道任务成功/失败/限频/策略拒绝均有复盘，见 [ADR-012-after-action.md](../adr/ADR-012-after-action.md)；
- `Episode + MemorySlice + ContextAssembler` 已实现统一任务上下文，MC+B站可共享 Episode，QQ 等未参与场所默认隔离，见 [ADR-013-episode-context.md](../adr/ADR-013-episode-context.md)；
- `Memory` 已按 residence scope 隔离，`/presence` 已提供 system/QQ/B站/MC 的独立状态与整体聚合，详见 [ADR-010-cross-channel-presence.md](../adr/ADR-010-cross-channel-presence.md)。
