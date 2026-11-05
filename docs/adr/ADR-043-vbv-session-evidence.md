# ADR-043：有界 VBV 与编码会话证据

日期：2026-11-05
状态：Accepted（本地与公开 VBV 验证通过；附带节奏样本不足已标记）

## 背景

仅设置 `-b:v` 不能明确限制场景变化时的码率峰值。另一个问题是，重连会重置节奏统计，最后一段编码器的指标容易被误读为整场直播的指标。

## 决策

### 有界 VBV

- 默认 `rateControl='vbv'`：`maxrate=目标码率`、`bufsize=2×maxrate`。默认目标 3500k 时，参数为 `-maxrate 3500k -bufsize 7000k`。
- `HABITAT_BILIBILI_RATE_CONTROL=abr` 可回滚到不加 maxrate/bufsize 的旧行为。
- 可单独提供 `maxRateKbps`、`vbvBufferKbps`，但 maxrate 不得小于目标码率，bufsize 不得小于 maxrate。
- 这是码率峰值和 VBV 缓冲边界，不宣称 nal-hrd CBR、恒定实际码率或零缓冲。静态画面的实际码率低于目标是允许的。

### 编码会话

- 每次 FFmpeg 启动/重连增加 `sessionId`，记录 `startedAt`。
- 退出时保存 `stoppedAt`、`durationMs`、`stopReason`、`exitCode`、脱敏错误、节奏指标和进度快照。
- `recentSessions` 最多保留最近 8 个已完成会话，另有当前活动会话；它不是进程历史的无限总和，也不代表重启前的旧进程。
- `stop_timeout` 单独记录，不能记成正常 owner_stop。
- `lastKnownProgress` 继续保留最近一次已知的非零输出进度，和每个会话自己的 `progress` 分开。
- Owner 获得完整脱敏会话；Agent 只获得会话 id、时间、停止原因、帧数、输出时间和丢帧摘要，不包含 RTMP、推流码、Owner intentId 或原始错误。

## 验证

- `stream/verify-rate-control.mjs`：VBV 参数、ABR 回滚和非法上限拒绝。
- `stream/verify-ffmpeg-progress.mjs`：重连前后会话、退出原因、退出码、帧龄和进度分别保存。
- `stream/verify-playback-timing.mjs`：真实 FFmpeg 使用 VBV 输出，验证真实会话进度、视频/音频时间戳和 owner_stop。

这些验证只证明参数和证据正确，不证明公开网络没有拥塞。公开验证仍需有效会话，且 `autonomous=off` 不变。

2026-11-05 的首次公开短测中，播放地址持续 404，未进入 LIVE，最终 `verification_failed`；输出已停止。该次会话仍正确产生 VBV 状态和 3 个独立的编码会话记录，但不能作为公开播放验收。需要使用新的有效推流会话重试，不能据此判断 VBV 对观看端的效果。

随后使用有效会话完成 90 秒公开验证：`rateControl=vbv`、`maxRateKbps=3500`、`vbvBufferKbps=7000`，进入真实 LIVE，最终 `stopReason=max_duration`，`reconnectCount=0`。完整会话持续 94106ms，写入 450 帧、重复 165 帧、无调度丢帧，进度输出时间为 88234.667ms，会话退出按 owner_stop 记录，调度停止原因按 max_duration 记录。附带播放样本只有 1 个视频帧且没有音频帧，修正后的分析器将其标为 `insufficient_video_frames` 和 `insufficient_audio_frames`，`sample.videoUsable=false`、`sample.avUsable=false`，不把该样本当成节奏验收通过。证据保存在 `data/artifacts/stream-vbv-short.json`。
