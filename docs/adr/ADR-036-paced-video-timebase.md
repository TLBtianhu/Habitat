# ADR-036：按墙钟节奏输出视频帧，修复音视频时间轴漂移

日期：2026-11-05
状态：Accepted（15 分钟节奏与证据复测通过；主观观看反馈待确认）

## 背景

15 分钟真实直播虽然完成了调度、音视频证据和自动停止，用户实际观看却频繁出现“正在缓冲”。因此调度完成不能直接等于观看体验稳定。

旧实现以 `image2pipe -framerate 5` 给输入帧分配时间戳，但实际捕获只有约 3fps；`SceneRecorder` 已计算的真实 `ptsMs` 没有被输出使用。音频 PCM 按真实时间连续输出，视频却按声明帧率产生另一套时间轴。

## 调查依据

- B 站一键开播是 `grantUrl` 用户确认 → 一次性 `live_token` → `startLive` 返回 `push_url/live_key` → `endLive`，与普通 OBS 推流码不同；公开文档未给出固定 `trid` 刷新周期。
- B 站《通过 OBS 推流》只讲采集源和开播，不规定帧时间戳算法。
- OBS 编码器使用系统时间保持多个编码器同步：[obs-encoder.c](https://github.com/obsproject/obs-studio/blob/403f01e2a36fd0db4a67b5513437e77fd1871f6d/libobs/obs-encoder.c#L1402-L1411)。
- OBS 输出端归零音视频起始时间并按 DTS 排序交织：[obs-output.c](https://github.com/obsproject/obs-studio/blob/3e915917a77ecc2feb74f0383598c5abdd822692/libobs/obs-output.c#L1443-L1466)。
- OBS 的 FLV 封包保留 DTS 和 PTS-DTS composition offset：[flv-mux.c](https://github.com/obsproject/obs-studio/blob/c3f82dca139e4bdcfc974689d34665fce9185ca9/plugins/obs-outputs/flv-mux.c#L452-L490)。

本实现只参考机制，不复制 OBS 的 GPL 代码。

## 决策

- 新增 `PacedVideoInput`：按真实墙钟节奏向 FFmpeg 写入固定输出帧率，而不是让捕获速度与声明帧率各自漂移。
- 新帧只保留最新一份；可重复最新帧维持节奏。编码或网络落后时丢弃中间调度间隔，不爆发式补写，不建立无限历史队列。
- 最新源帧超过 2500ms 未更新时，写入明确生成的纯黑待机帧，不把旧画面冒充实时。没有源帧时也允许以待机帧开始，LIVE 仍只能由独立播放证据决定。
- 帧写入器绑定每次 FFmpeg 启动/重连/停止生命周期；旧定时器不得写入新进程。
- `frames` 保留源帧数；新增 `writtenFrames`、`duplicatedFrames`、`droppedFrames`、`standbyFrames`、`lastWriteAt`、`lastFrameAgeMs`，并在停止后保留最后一次节奏统计。
- `pacing=true` 为默认；`pacing=false` 仅用于回归对照，不作为模型可选能力。
- 真实音频继续使用 Mixer PCM/AAC，不用静音 AAC 代替真实声音，也不通过改大码率掩盖时间轴问题。

## 本地复现与验证

受控测试使用相同 36 张输入帧、声明 5fps、持续 PCM 音频，输出本地 FLV，不访问 B 站：

- `pacing=false`：真实输入约 13.025 秒，输出媒体时长 **7.221 秒**，复现了时间轴缩短。
- `pacing=true`：真实输入约 12.211 秒，写入 60 帧，输出媒体时长 **12.021 秒**；音视频时长差为 0。

FFprobe 显示视频 time_base 为 1/1000。该结果证明旧实现的时间轴问题可在本地复现，并证明墙钟写入能修复该特定问题；它不是“公开直播永不缓冲”的保证。

`stream/verify-paced-video-input.mjs` 另覆盖：待机帧、最新帧重复、过期待机、落后丢帧与停止清理。

## 公开验收边界

另以最长 90 秒公开短测截取独立播放样本，记录实际输出节奏、公开媒体时长和观看结果。公开短测通过后仍需重新进行最长 15 分钟稳定性验收，不能把本地 FLV 结果或调度自动停止等同于观看体验稳定。

2026-11-05 的公开短测使用新 `trid`，进入真实 LIVE 后取得 **6.016 秒、5fps** 的独立播放样本。最终源帧 282、实际写入 447 帧，重复最新帧 165 次，丢弃 5 个落后调度间隔，待机帧 2 帧，未发生重连，并以 `max_duration` 停止。证据保存在 `data/artifacts/stream-paced-short-evidence.json` 和 `playback-paced-sample.flv`。这些结果证明公开时间轴与输出节奏已对齐；观看端是否仍出现缓冲仍需在 15 分钟复测中继续观察，不能仅凭进程或样本断言观看体验。

## 验证扫描与 LIVE 状态

复测还发现：一次 ffprobe/FFmpeg 探测超时会把 `playbackDecoded` 清零，如果同时把它当作 LIVE 开关，就会让已有成功证据的会话反复抖动。

因此 `playbackDecoded` 只表示最近一次探测是否成功；`verified` 表示仍在 TTL 内的真实成功播放证据。探测进行中若已有新鲜证据，状态保持 `verified` 并另标 `checkInFlight`，不立即降级。`lastVerifiedAt` 超出 TTL、输出重连或停止时才退出 LIVE。重连后必须用当前会话的新证据恢复，不能拿历史证据冒充在线。

## 15 分钟复测结果

修复后的 Owner 会话完成最长 15 分钟测试，最终 `stopReason=max_duration`，`autonomous=off`，输出和音频 capture 均停止，冷却按 `lastStoppedAt + 600000ms` 计算。整场源帧 2701；最后一个编码会话写入 1862 帧、重复最新帧 704 次、丢弃 27 个落后调度间隔、待机帧 2 帧。观察记录中有两次重连，均重新取得播放证据后恢复，未以历史证据伪装持续在线。

首次公开非静音证据为 `audioVerifiedAt=1793855447905`、`audioEvidenceMaxVolumeDb=-6.2`、AAC，关联 utterance 28；不据此声称语义转写或正式大肥鱼音色。最终证据保存在 `data/artifacts/stream-stability-latest.json` 和 `stream-stability-first-audio.json`，其中 `pacing.scope` 明确区分整场源帧与最后一个编码会话的写入统计。

这证明本轮公开节奏、音视频证据、重连恢复与调度停止成立；用户主观观看端是否仍有缓冲仍需反馈，不能仅凭这些指标宣称所有网络与播放器场景都绝对无缓冲。
