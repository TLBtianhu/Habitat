# ADR-034：将 stream.propose 接入真实 AgentLoop

日期：2026-11-05
状态：Accepted（隔离测试通过，生产默认 autonomous=off）

## 背景

ADR-033 的 Agent 凭证 HTTP 验收只证明控制面可以按策略执行 Agent 请求，不代表大肥鱼的 LLM 决策循环已经拥有该能力。直接把 Owner 启停接口、RTMP 配置或编码器交给 Agent 会破坏权限边界。

## 决策

- `agent/run-continuous.mjs` 只新增一个闭集动词 `stream.propose`。
- Agent 进程使用 `StreamControlClient` 访问 `/stream/propose` 和 `/stream/agent/status`。控制面 `StreamScheduler` 仍是唯一执行者；Agent 不直接调用 ScenePreview、outlet、Owner start/stop 或推流配置接口。
- start 只接受 `action/room/scene/maxDurationMs`；stop 只接受 `action/intentId`。其他字段（包括 RTMP URL、streamKey、actor、任意 idempotencyKey）一律拒绝。
- start 的 `intentId` 由运行时根据稳定事件 ID 生成；无新消息时使用持久化的 Episode checkpoint/revision。模型不能自行指定 start ID。
- stop 可省略 ID，但只能从 Agent 自己的 pending/current session 解析。`lastActor` 持久化，Agent 不能停止 Owner 会话；Owner 停止始终优先。
- 当前 residence 为 QQ、B 站或其他外部来源时拒绝该动词，普通消息不能绕过 Owner 授权。

## 只读状态与秘密边界

`GET /stream/agent/status` 返回 `agentStreamStatus()` 的脱敏投影：

- 包含策略、状态、冷却、额度、输出和播放证据摘要；
- 不包含 RTMP URL、streamKey、Token 或 Owner 的 `intentId`；
- 只调用 `StreamScheduler.status()`，**绝不调用 `tick()`**。观测、复盘和恢复不能启动 scheduled 输出、主动停止或触发播放验证。

Agent Token 只存在于客户端内部，不进入 LLM 观测、提示词、Episode 或 AfterAction。

## 幂等与恢复

- start 在 HTTP 前写入 `initialRefs.intentId`；响应后补充 disposition、startedAt、firstVerifiedLiveAt 和 lastStoppedAt。
- ActionTracker 新增 `allowDuplicateRun=false` 与 `recordSkill=false` 选项。stream 使用两个选项：重复请求不得再次执行，播放或安全拒绝不得自动变成可复用技能。其他动作的默认行为不变。
- Tracker 幂等键使用 `stream-start:<intentId>` 与 `stream-stop:<intentId>`，避免同一会话的启停互相碰撞。
- Scheduler 对重复 `intentId` 再做一层去重。重启时 scheduled/starting/live/reconnecting/stopping 全部进入 interrupted 并清除 pending；后续只读 tick 不得重放公开开播。
- POST 网络错误属于结果不明，不是确定的执行失败：保持 unknown，禁止自动重试，后续只读证据核对。
- Agent 是 stream pending writes 的单一复盘写入者。Control Recovery 不与其并发重写 Episode；它展示 pending 与调度风险，Agent 启动后注册同一核验器并完成只读复盘。
- Recovery 将 `interrupted` 或输出仍为 starting/running/stopping/reconnecting 标为 `stream.requiresAttention`，只提示 Owner，不自动启停。

## 证据语义

- `autonomous_disabled/requires_refresh/daily_limit` 等明确的未启动结果：`policy_enforced=true`、`verified_live=false`，表示该 start 意图没有达到 LIVE，不表示系统不安全或成功开播。
- scheduled、starting、reconnecting、stale、传输结果不明：unknown，不能记为 LIVE。
- 当前 LIVE 必须匹配同一 intent、startedAt、running output 和 fresh decoded playback。
- 若同一 intent 已持久化 `firstVerifiedLiveAt`，随后停止不妨碍 start 的历史成功核验；没有这段历史时，单凭 stopped 不能推断曾经 LIVE。
- stop 独立核验同一 intent、output stopped、live=false 以及 accepted stop 或不早于停止请求的 lastStoppedAt。停止成功不回溯证明 start 成功。

## 验证

- `agent/verify-stream-proposal.mjs` 使用真实 AgentLoop 类和模拟输出，覆盖 off、策略改变后的重复请求、参数注入、跨渠道拒绝、Agent 自己的启停、当前/迟到 LIVE、独立 stop、Owner ID 脱敏、传输不确定性与响应丢失恢复。
- `agent/verify-action-tracking.mjs` 覆盖 allowDuplicateRun=false、recordSkill=false、initialRefs 崩溃窗口和只读恢复。
- `stream/verify-stream-scheduler.mjs` 覆盖重复 intent、Owner 会话停止拒绝、scheduled 取消与重启隔离。
- `control/verify-bilibili-settings.mjs` 覆盖 Agent 状态接口权限与秘密排除。
- `control/verify-recovery.mjs` 覆盖 interrupted 和 output-running 的恢复提示。

本 ADR 的接入测试不需要真实 RTMP，也不会自动公开开播。生产部署后仍须确认 `autonomous=off`；以后是否开启 anytime/windowed 是 Owner 的独立明确操作。
