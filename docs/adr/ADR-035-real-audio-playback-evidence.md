# ADR-035：真实 Voice PCM 音轨与独立音频播放证据

日期：2026-11-05
状态：Accepted（实现与隔离测试通过；生产稳定性结果见测试记录）

## 背景

此前的 BilibiliRtmpOutput 只有无音轨或 anullsrc 静音 AAC。FFmpeg 正在运行、存在音频 capture、或播放端出现 AAC codec，都不能证明观众听到了真实语音。Voice 后端还存在 root:root 700 的临时目录，导致服务账号无法写出 WAV，健康探测却只检查模型和 binary。

## 决策

- 复用现有 Voice → Audio Mixer PCM 总线，不打开麦克风，不引入桌面/系统录音。
- `AudioCaptureClient` 只允许 loopback，校验 `s16le/48000Hz/stereo`，通过 `/capture/open` 创建新 baseline，避免重放旧讲话。
- `BilibiliRtmpOutput` 在 `audio=mixer` 时读取 `/capture/pcm`，显式映射 `0:v:0` 与 `1:a:0`，编码 AAC 128k。`silent` 仍只用于原有测试，不能冒充真实音轨。
- 每次启动/重连建立独立 capture；退出、启动失败和 Owner 停止都关闭对应 ID。旧会话清理不得关闭新会话。
- 生产通过 `HABITAT_BILIBILI_AUDIO=mixer` 显式启用；默认 `none` 保持兼容。
- Kokoro 健康探测同时检查输出目录可写性；安装器将实例 `tmp` 归属服务账号。

## 播放证据

`HABITAT_PLAYBACK_REQUIRE_AUDIO=1` 是测试模式，不能只配置 mixer 就宣称已验证声音。

- 独立读取公开房间 playUrl，使用 ffprobe 验证音视频流，FFmpeg 解码并使用 `volumedetect`。
- 第一次必须取得 `max_volume > -55dB` 的非静音样本，记录 `audioVerifiedAt` 和峰值 `audioEvidenceMaxVolumeDb`。
- 后续正常讲话间隙允许静音；`audioMaxVolumeDb/audioNonSilent` 表示当前样本，不覆盖首次峰值证据。
- 新会话重置音频证据。音轨消失或音频解码失败仍按验证失败处理。
- 音量证据不等于语义识别。测试记录关联 utterance ID/hash 与播放采样时间，但不声称已证明说出的就是该句，也不把通用 Kokoro 测试音色称为大肥鱼正式音色。

## 15 分钟测试方式

- Owner 显式 `/stream/start`，`maxDurationMs=900000`，`autonomous=off` 不变。
- 预热 TTS；输出显示 `audio=mixer` 且有 capture ID 后，创建新的 2–4 秒短句，跨 CDN 延迟重复，直到独立播放端取得首次非静音证据或验证超时。
- 观察重连、帧进度、播放证据与正常静音间隔；Owner 可随时停止。
- 完整测试要求调度器以 `max_duration` 停止，并关闭输出和音频 capture。Owner 提前停止只能记为提前终止，不能冒充完整时长。
- 记录 `stream-stability-latest.json`，不含推流码、URL 或 Token。

## 边界

- 混流器会静音填充，队列上限 5 秒；长句可能截断，因此只用短测试句。
- 新 utterance 会进入所有活动 capture；直播期间不得生成私人语音。
- 旧 outlet-supervisor 与 ScenePreview 使用不同配置和生命周期，同一场直播只能选择一个输出路径，不能同时推流。
- 调度 tick 有间隔，最大时长停止允许小的时间容差。

## 验证

- 2026-11-05 本地修复：Voice 服务账号无法写入 root:root 700 的实例 `tmp`，已改为服务账号所有权；真实 Kokoro 随后成功生成 ready WAV。通用测试音色不视为大肥鱼正式音色。
- 首轮生产尝试中，真实 PCM capture 和测试 utterance 均成功，但 B 站房间持续 `liveStatus=0`、播放地址 404，未进入 LIVE，未获得音频播放证据，已停止输出与 capture。该轮不计为稳定性通过，需使用新的有效推流会话参数重试。
- `stream/verify-audio-playback.mjs`：PCM 参数、显式映射、重连/启动失败清理、ScenePreview factory 传播、无音轨拒绝、非静音阈值、后续正常静音和峰值保留。
- `voice/verify-kokoro-backend.mjs`：模型文件与输出目录可写性。
- 原有 RTMP reconnect、PlaybackVerifier、StreamScheduler、ScenePreview 和 AgentLoop 测试必须保持通过。
- 生产实测结果以 `data/artifacts/stream-stability-latest.json` 为准，不用进程状态或静音 AAC 代替播放证据。
