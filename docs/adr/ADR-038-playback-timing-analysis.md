# ADR-038：公开播放帧间隔与音视频节奏分析

日期：2026-11-05
状态：Accepted（本地与公开 6 秒样本验证通过）

## 背景

`progress.speed` 只能表示 FFmpeg 处理速度，不能单独说明观看端节奏。需要直接分析公开播放样本，才能区分源帧节奏、封包时间戳和播放器接收表现。

## 决策

- 新增 `stream/playback-timing.mjs`，通过公开 playUrl 的 ffprobe `show_frames` 分析真实帧，不读取推流凭证。
- 使用 FFmpeg `-t 6` 先截取原封包样本，再用本地 ffprobe `show_frames` 分析真实帧，不读取推流凭证；避免在直播输入上用不合适的定位/读取方式。公开样本另存为 `playback-timing-sample.flv`。
- 视频使用 `best_effort_timestamp_time` 统计展示间隔；保留原始顺序检测非单调时间戳，排序仅用于间隔统计。
- 输出：
  - 帧数、首末时间、持续时间；
  - 间隔 P50/P95、最大间隔；
  - 非单调时间戳数量；
  - 音视频起始时间差和持续时长差；
  - `mediaToWallRatio` 仅供分析，不作为健康阈值。
- 初始警报：`video_gap_over_2000ms`、`av_start_skew_over_500ms`、`av_span_skew_over_500ms`、非单调音视频时间戳。警报是观察信号，不单独证明或否认播放器缓冲。
- `POST /bilibili/live/timing` 只允许 Owner 主动调用，且仅在输出 running 时执行；不调用 `tick()`，不自动开播，不返回播放 URL 或推流码。

## 本地真实验证

`stream/verify-playback-timing.mjs` 现场生成本地 FLV，避免依赖旧文件或公开会话：

- 视频 13 帧，间隔 P50/P95 为 200ms，无非单调时间戳；
- 音频 122 帧，间隔约 21ms，无非单调时间戳；
- 音视频起始差 21ms，持续时长差 181ms；
- `alerts=[]`。

这证明分析器能读取真实媒体帧并计算节奏，不代表所有公开播放都稳定。

## 公开验证边界

另以最长 90 秒公开会话读取 6 秒播放样本，保存 `stream-timing-short.json`，包含帧间隔、最大间隔、起始差、持续时长差、非单调计数和 alerts。只有同时结合真实 LIVE、媒体样本和实际观看反馈，才能判断节奏是否改善；不能仅凭 codec、speed 或调度状态宣布无缓冲。

2026-11-05 的公开验证进入 LIVE，样本中视频 30 帧、间隔 P50/P95 为 200ms，音频 282 帧、间隔约 21ms，音视频起始差为 0，持续时长差为 195ms，非单调计数均为 0，`alerts=[]`，最终 `stopReason=max_duration`。`mediaToWallRatio≈1.779` 只描述本次原封包采样与处理墙钟的比例，不作为健康判断。证据保存在 `data/artifacts/stream-timing-short.json` 与 `playback-timing-sample.flv`。
