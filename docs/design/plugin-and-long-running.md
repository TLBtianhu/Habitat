# 插件化与长期持续执行：Habitat 下一步架构

> 2026-11-02 · 对照当前硬编码、DSH 插件机制及传统 QQ/B站机器人保活方式。

## 1. 当前仍然硬编码的部分

- `agent/run-continuous.mjs` 手工 `session.open()` 列出 desktop、voice.library、mc、qq、bilibili；
- Broker 用 if/else 写死动词与客户端路由；
- `mcp/mc-server.mjs` 的 `tools` 数组手工列 schema，`callTool` 再手写映射；
- Adapter manifest 目前只有 name/version/entry/capabilities/scopes，尚未包含工具、obs、权限、配置、依赖和生命周期。

这会形成“加应用必须改循环、加工具必须改 Broker、MCP 与 Broker 两处漂移”。

## 2. 应学习 DSH 的插件化逻辑，而不是照抄复杂度

保留 Habitat 的 AppSession 和实时边界，引入四个注册概念：

### AdapterManifest（声明）

```jsonc
{
  "id": "mc",
  "version": "0.2.0",
  "entry": "server.mjs",
  "session": { "kind": "mc", "view": { "kind": "firstPerson" } },
  "obs": [{ "type": "mc.obs", "handler": "obs" }],
  "tools": [
    { "name": "mc.walk", "handler": "walk", "scope": "mc.action",
      "concurrency": "exclusive", "idempotency": "per-intent" },
    { "name": "mc.say", "handler": "say", "scope": "mc.chat",
      "concurrency": "serial", "idempotency": "required" }
  ],
  "surface": { "provider": "mc-pixels", "optional": true },
  "requires": [],
  "permissions": ["mc.join", "mc.chat", "mc.action"],
  "configSchema": { "type": "object", "additionalProperties": false },
  "lifecycle": { "startup": "on-demand", "shutdown": "adapter-host" }
}
```

### Provider（受信任实现）

- 实现 manifest 声明的 obs/tools/surface/lifecycle；
- 只允许主人安装/更新，普通消息不能注册新实现；
- 返回结构化结果和明确错误，不允许虚构成功。

### Loader / Registry（注册与所有权）

- 校验 manifest、版本、权限和依赖，按 profile 启停；
- 工具注册包含 handler、schema、并发策略、超时、幂等和 disposer；
- Loader 拥有注册生命周期，卸载时统一清理，插件不能自行残留监听；
- AppSession 保存声明，Provider 不直接改 AppSession 或另一插件的状态。

### Profile（应用组合）

- 用配置列出启用应用及其配置，代替 `run-continuous` 手写启动清单；
- 新应用只新增目录 + manifest + provider，不改 AgentLoop；
- Broker 只做通用校验和按名分发，不再写每个应用的专用 if/else；
- `mcp/mc-server.mjs` 的 `tools/list` 由同一 Registry 生成，保证 MCP schema 与真实执行一致。

## 3. 长期在线：传统机器人不是“每秒都在思考”

QQ 机器人能随时在群里发言，依靠的是：

```text
持久 WebSocket / 定期轮询
  + heartbeat / ping-pong / idle timeout
  + 断线重连（指数退避 + jitter）
  + 进程监督与崩溃重启
  + 事件去重与水位恢复
  + 有界队列和消息处理
```

LLM 只是一个事件处理器。主动发言是另一条**定时/安静期任务**，不能让 LLM 无约束地每 5 秒自行输出。

## 4. Habitat 的持续执行模型

```text
ConnectionSupervisor（每适配器一个）
  连接、心跳、重连、去重、健康状态
        ↓ 追加事实
Durable Inbox（事件 id、时间戳、来源、水位）
        ↓ 按房间/通道有界排队
AgentWorker（有界 turn、取消、超时、幂等）
        ↓ intent/outbox
Action Adapter（发送、确认、重试、终态）
```

### 必须具备的可靠性规则

1. **连接与认知分离**：长 LLM turn 不能阻塞事件接入和连接心跳。
2. **单写者**：每个会话/通道的动作串行；跨通道并发受全局预算限制。
3. **有界队列**：owner 消息不得静默丢弃；低优先级观众消息可合并或标 TTL，超限进入 dead-letter。
4. **幂等**：接收至少一次 + 事件 id 去重，发送使用 idempotency key，不能宣称天然 exactly-once。
5. **可恢复**：保存 inbox/outbox 水位、当前任务、应用代数和最后确认结果；重启先对账再接新事件。
6. **断线策略**：指数退避 + jitter + 最大间隔，稳定一段时间后重置；使用 monotonic 计算超时。
7. **健康分层**：进程活着、连接 ready、模型 ready、应用 ready 是不同状态，不能只按进程 PID 判健康。
8. **局部重启**：哪个适配器失效就重启哪个，不能因为 LLM/QQ/B站/MC 一个失败就拖垮整个 Habitat。
9. **关闭语义**：先停止新事件，再完成或取消当前 turn，刷新 outbox，最后关闭连接；禁止新动作闯入。
10. **主动行为**：仅由 scheduler/安静期策略触发，带频率、额度、显著性和频道隔离，不能自由生成连续独白。

## 5. 监督与诊断字段

- `lastEventAt / lastHeartbeatAt / lastReconnectAt`；
- `connectionState / modelState / appState / queueDepth / inflightId`；
- `lastIntentId / lastActionOutcome / lastError / retryCount / droppedCount`；
- `sessionId / generation / pluginVersion / currentPreset`。

健康检查应看这些字段，而不是只看 `systemctl is-active`。这也是传统 bot 与“LLM 脚本还没崩”的本质区别。

## 6. 推荐实施顺序

1. 先做 `AdapterManifest + PluginRegistry`，把启动清单和工具 schema 从代码移出；
2. 用统一 `ConnectionSupervisor + Durable Inbox/Outbox` 替代简单 setInterval；
3. 接入 MC/QQ/Bili 的事件去重、水位、重连与限频；
4. 最后才接 DSH/复杂 Agent turn，保持其长任务不会阻塞连接监督。

## 参考

第一阶段已经实现并验证：`AdapterManifest + PluginRegistry` 统一 AppSession/工具/生命周期，`DurableEventPump` 提供持久化去重、背压死信、退避和重启恢复，MCP 与 Broker 共用同一工具表。验收记录见 [ADR-006-plugin-event-pump.md](../adr/ADR-006-plugin-event-pump.md)。

第二阶段已经实现并验证：`DurableOutbox` 提供稳定 intent、幂等、终态和迟发结果，`BiliConnectionSupervisor` 提供 B 站真实 WSS 连接、心跳、重连与有界关闭。验收记录见 [ADR-007-outbox-bilibili.md](../adr/ADR-007-outbox-bilibili.md)。

QQ OneBot 监督器已落地：心跳、消息去重、群隔离、背压和认证失败处理见 [ADR-009-onebot-supervisor.md](../adr/ADR-009-onebot-supervisor.md)。真实账号登录、真实私聊/群聊输入、策略绑定 addressed 回复与常驻只读默认已验收，不以模拟事件替代。

跨频道 ControlTask、分场所记忆与 Presence 聚合已实现，验收见 [ADR-010-cross-channel-presence.md](../adr/ADR-010-cross-channel-presence.md)。

分场所持久记忆已实现 JSONL、TTL、脱敏、重启恢复与 owner-approved 共享，验收见 [ADR-011-residence-memory-store.md](../adr/ADR-011-residence-memory-store.md)。

AfterAction 自我复盘与证据验收已实现，自评不能覆盖失败，验收见 [ADR-012-after-action.md](../adr/ADR-012-after-action.md)。

Episode 统一任务上下文与 MemorySlice 已实现，验收见 [ADR-013-episode-context.md](../adr/ADR-013-episode-context.md)。

- DSH 插件与 profile 机制：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- NoneBot 事件与插件框架：https://github.com/nonebot/nonebot2
- AstrBot 危险执行沙箱：https://github.com/AstrBotDevs/AstrBot
- WebSocket ping/pong：https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2
- Docker restart policies：https://docs.docker.com/engine/containers/start-containers-automatically/
- systemd RestartRandomizedDelaySec：https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#RestartRandomizedDelaySec=
