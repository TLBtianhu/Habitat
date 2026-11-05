# ADR-037：单调时钟、FFmpeg 输出进度与重连证据

日期：2026-11-05
状态：实现与本地验证通过，公开短测中

## 背景

ADR-036 已修复墙钟帧节奏和播放证据抖动，但仅凭 `writtenFrames/droppedFrames` 仍不能区分捕获慢、编码慢和实际输出慢。`reconnectAttempts` 又会在成功写入后归零，无法还原整场重连历史。

OBS 的相关机制包括：使用单调时钟、记录迟到帧、按发送缓冲的 DTS 时长判断拥塞，以及报告实际丢帧，而不是把进程运行当成网络健康。

## 决策

### 单调调度时钟

- `PacedVideoInput` 使用 `performance.now()` 计算帧间隔，避免系统校时影响调度。
- `wallNow()` 仅用于证据时间与帧龄，避免把两个时钟混算。
- 新增 `lastWriteFrameAgeMs`，记录实际写入那一刻的帧龄，和查询时的 `lastFrameAgeMs` 分开。
- 墙钟倒退不能造成调度爆发，帧龄不得为负。

### FFmpeg 原生进度

在输出中增加 `-progress pipe:2`，解析：

- `frame/fps`；
- `out_time_us/out_time_ms`（FFmpeg 数值转换为毫秒）；
- `total_size`；
- `speed`；
- `dup_frames/drop_frames`；
- `bitrate`。

保留两套字段：

- `progress`：当前 FFmpeg 进程的进度；
- `lastKnownProgress`：最近一次已知的非零输出进度，重连或停止后不丢历史证据。

`speed` 是 FFmpeg 的处理速度，可能受编码、输入空闲、背压和收尾影响，**不是独立的网络测速**，不能单独用来判定平台健康或观看端无缓冲。

### 累计重连证据

新增：

- `reconnectCount`：实际安排重连的次数；
- `lastReconnectAt`：最近一次非预期断开的时间；
- `lastRecoveredAt`：最近一次实际写入新帧的恢复时间；
- `lastReconnectDurationMs`：断开至恢复写入的耗时。

恢复必须以真实写入新帧为准，不能只以子进程启动为准。Owner 停止期间不得把下一次启动算作旧重连的恢复。

## 本地验证

- `stream/verify-ffmpeg-progress.mjs`：跨参数解析、真实帧龄、重连累计、恢复耗时、停止后的最后已知进度。
- `stream/verify-paced-video-input.mjs`：单调调度、墙钟倒退不爆发、帧龄不为负、过期待机和背压丢弃。
- 真实 FFmpeg 输出本地 FLV：`muxFrame=11`、`outTimeMs=2176`、`outSizeBytes=7358`，证明 `-progress pipe:2` 的字段确实产生并可解析，而不是 mock 中的假象。

这些数值只证明输出进度存在，不代表码率达标、网络不拥塞或观看端不缓冲。

## 公开验证边界

以最长 90 秒公开短测保存 `stream-observability-short.json`，包含当前/最后已知进度、重连历史、真实帧龄和停止原因。是否继续调整 `maxrate/bufsize` 或输出帧率，必须结合这些指标与实际观看结果决定，不预设需要升帧或降码率。
