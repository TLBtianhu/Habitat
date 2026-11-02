# ADR-006：插件注册表与持久化事件泵

> 2026-11-02 · 对应“应用/工具硬编码”和“长期持续执行”的第一阶段落地。

## 决定

### 1. Manifest + Provider + Loader 所有权

- `adapters/plugin-manifest.mjs` 严格校验 `schemaVersion`、id、lifecycle、tool schema、scope、并发、幂等和依赖；
- `PluginRegistry` 统一生成 AppSession、工具清单和生命周期动作；
- 工具实现由每个插件自己的 `provider.mjs` 注册，Loader 按插件加载和缓存，禁止普通消息注册新实现；
- `adapter / outlet / client / declarative` 生命周期分别处理，Broker 不再写每个应用的专用启动路由；
- `mcp/mc-server.mjs` 的 `tools/list` 与真实执行使用同一 Registry，不再维护两份工具表；
- `system.chat`、`voice.library`、`desktop`、`hls`、`mc`、`qq`、`bilibili` 已迁入声明式清单。

新增插件只需增加 `manifest.json + provider.mjs`，不修改 `run-continuous`。

### 2. DurableEventPump 负责持续接入

- 连接读取与 Agent 决策分离，长 LLM turn 不阻塞 poll/heartbeat；
- 事件先去重并持久化入队，处理完成才出队；
- 有界队列，超限显式进入 `deadLetter`，不静默丢弃；
- 自己的消息只记录不触发，避免自回复；
- 错误按指数退避 + jitter 重试，成功心跳后重置；
- 控制面重置时重建水位；
- `/pump/status` 暴露水位、pending、deadLetter、最近成功心跳和退避状态，不把“进程活着”当健康。

### 3. 权限与输出边界不变

- `system.say` 仍只回控制台，`voice.speak` 才生成语音，`mc.say` 只进游戏；
- Desktop、Voice、Outlet 仍按原有按需生产和权限模型运行；
- 没有新增 Shell、公开推流、第三方应用或源码级 DSH fork。

## 实际验收

- `adapters/verify-plugin-registry.mjs`：AppSession、工具分发、生命周期、幂等和新增插件通过；
- `agent/verify-event-pump.mjs`：完成事件重启不重复、未完成事件重启补收、自消息过滤、背压死信、退避、控制面重置通过；
- `mcp/verify-mcp.mjs`：initialize、tools/list、tools/call 与 Registry 一致；
- 真实 LLM：`system.say` 回答、`voice.speak` 指定音色、文字-only 不产生 Utterance、Agent 重启不重复回答；
- 既有回归：SkillRuntime 10/10、PhaseMachine 16/16、AppSession/Compositor/Outlet Supervisor/Control tasks 全通过；
- `/pump/status` 实际返回心跳和空队列，测试消息与测试音频已清理，主人样本保留。

## 尚未覆盖 / 下一步

- QQ/B站真实 WebSocket 的独立 ConnectionSupervisor、心跳和重连尚未接入；
- Durable Inbox 已有，但完整的稳定 intent/outbox（跨进程终态、迟发结果抑制、动作确认与重放）仍需下一步；
- Tool timeout 是有界等待，不等于强制杀掉 provider 内正在执行的代码；
- DSH 原生认知驱动仍只作为后续可选项，不改变本阶段已验证的闭集 Broker。
