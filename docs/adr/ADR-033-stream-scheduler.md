# ADR-033: StreamScheduler 自主开播调度

日期：2026-11-05
状态：Accepted（策略、HTTP、真实 RTMP 与播放验证通过）

## 决策

自主开播由 `StreamPolicyStore + StreamScheduler` 负责，不复用 `autoStart`。默认 `autonomous=off`，服务启动、控制台打开或模型提出想法都不会自动公开推流。

- owner 可以手动 `stream.start`、`stream.stop`，不受 autonomous 开关限制。
- agent 只能通过 `stream.propose` 提交闭合意图；`off` 返回 `proposed` 且不启动。
- `anytime` 允许在冷却和额度内启动；`windowed` 只有进入授权时间窗才启动，窗口外为 `scheduled`。
- `room=default`、`scene=desktop-main` 是受控别名，模型不能传 RTMP URL、streamKey 或任意目标。
- `intentId` 用于停止同一场直播；owner 停止始终拥有最高权限。

## 状态与证据

状态包括 `proposed/scheduled/starting/live/reconnecting/stopping/stopped/degraded/interrupted`。

- `starting` 表示输出已启动但还没有足够播放证据。
- `live` 只能由独立 `PlaybackVerifier` 的真实解码结果产生，不能由 FFmpeg 启动、TCP 可达或旧证据推断。
- `requiresRefresh` 在播放/输出/网络失败、过期或调度重启后提示更新；agent 不得在此状态自主启动。
- `lastCheckedAt`、`lastVerifiedAt`、`startedAt`、`lastStoppedAt`、`cooldownUntil`、`dailyMs`、`stopReason`、`lastIntentId` 和 `lastError` 用于审计。
- 单次时长、每日额度、冷却、验证超时和 `stopOnEvidenceFailure` 在 `tick()` 中执行。
- 调度状态写入根目录 `state/stream-scheduler.json`，重启不会自动恢复公开推流，而是进入 `interrupted`。

## API 与页面

- `GET/POST /stream/policy`：owner 管理策略，文件权限 600。
- `GET /stream/status`：owner 读取状态并执行一次 tick。
- `POST /stream/propose`：owner 或 agent 提交闭合 start/stop 意图，actor 由服务端凭证决定。
- `POST /stream/start`、`POST /stream/stop`：owner 手动启停。
- 控制台可配置 off/anytime/windowed、时间窗、时长、冷却、验证超时和失败策略，显示真实 LIVE、停止原因、冷却和验证时间。

## 验证

- `stream/verify-stream-scheduler.mjs`：off、owner/agent、冷却、单次/每日时长、验证失败、窗口外预约与窗口内启动。
- `control/verify-bilibili-settings.mjs`：owner/agent HTTP 权限、off 拒绝和策略页面。
- 生产用有效 RTMP 配置验证 owner 与 agent 启动、真实播放、LIVE、owner/agent 停止、停止原因和冷却；结束后恢复 `autonomous=off`。

## 推流码刷新边界

B 站公开资料没有给出 Habitat 可以固定推断的推流码刷新周期。`trid` 变化只说明本次推流参数更新，不能据此宣称固定过期时间。推流码可能轮换、撤销或触发风控；当前是否有效必须由真实 RTMP 结果、房间 `liveStatus` 和独立播放验证判断。失效时进入 `degraded/stale/stopped` 并提示 `requiresRefresh`，不伪造可永久复用。
