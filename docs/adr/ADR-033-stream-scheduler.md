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
- `live` 只能由当前输出仍为 `running`、且独立 `PlaybackVerifier` 本轮真实解码成功的证据产生，不能由 FFmpeg 启动、TCP 可达或旧证据推断。
- `verification.state=verified`、`verified=true`、`playbackDecoded=true` 和 `lastVerifiedAt` 必须同时成立；重连、检查中、过期和已停止证据一律不是 LIVE。
- `lastVerifiedAt` 只表示某次成功解码的历史时间，不是永久有效的开播凭证。
- `requiresRefresh` 在播放/输出/网络失败、过期或调度重启后提示更新；agent 不得在此状态自主启动。
- `lastCheckedAt`、`lastVerifiedAt`、`startedAt`、`lastStoppedAt`、`cooldownUntil`、`dailyMs`、`stopReason`、`lastIntentId` 和 `lastError` 用于审计。
- 单次时长、每日额度、冷却、验证超时和 `stopOnEvidenceFailure` 在 `tick()` 中执行。
- 调度状态写入根目录 `state/stream-scheduler.json`，重启不会自动恢复公开推流，而是进入 `interrupted`。
- 验证或启动的 `await` 期间收到停止请求时，立即显示 `stopping` 并合并排队；当前操作退出后必须真实停止输出，owner 请求优先。不得只返回旧状态而留下编码器。
- `lastVerifiedAt` 只证明当时曾成功解码，停止原因与冷却时间必须以实际完成的停止操作为准。

## API 与页面

- `GET/POST /stream/policy`：owner 管理策略，文件权限 600。
- `GET /stream/status`：owner 读取状态并执行一次 tick。
- `POST /stream/propose`：owner 或 agent 提交闭合 start/stop 意图，actor 由服务端凭证决定。
- `POST /stream/start`、`POST /stream/stop`：owner 手动启停。
- 控制台可配置 off/anytime/windowed、时间窗、时长、冷却、验证超时和失败策略，显示真实 LIVE、停止原因、冷却和验证时间。

## 验证

- `stream/verify-stream-scheduler.mjs`：off、owner/agent、冷却、单次/每日时长、验证失败、窗口外预约与窗口内启动；另覆盖验证中重复 owner 停止、真实停止去重、过期证据与重连不得显示 LIVE。
- `control/verify-bilibili-settings.mjs`：owner/agent HTTP 权限、off 拒绝和策略页面。
- 2026-11-05 生产实测：owner 链路曾取得真实播放解码证据（`lastVerifiedAt`），随后房间状态回落、播放地址 404，输出重连后断开；因此只记为短暂验证成功，不记为持续 LIVE。该轮同时暴露了验证期间停止请求被跳过的问题，已增加并发回归与修复。
- Agent 的真实 RTMP 启停验收须在新代码部署后另行执行；成功后恢复 `autonomous=off` 和原冷却配置，不把临时授权保留为永久自主开播。

## 推流码刷新边界

B 站公开资料没有给出 Habitat 可以固定推断的推流码刷新周期。`trid` 变化只说明本次推流参数更新，不能据此宣称固定过期时间。推流码可能轮换、撤销或触发风控；当前是否有效必须由真实 RTMP 结果、房间 `liveStatus` 和独立播放验证判断。失效时进入 `degraded/stale/stopped` 并提示 `requiresRefresh`，不伪造可永久复用。
