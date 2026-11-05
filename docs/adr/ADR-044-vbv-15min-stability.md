# ADR-044：OneBot 恢复后的 15 分钟 VBV 公开稳定性验证

日期：2026-11-06
状态：Accepted（OneBot ready 与 15 分钟公开验证通过）

## 目标

在恢复 OneBot WebSocket ready 后，使用有效会话验证 VBV 输出的持续时间、编码会话证据和公开播放节奏，不以单次 LIVE 或单帧样本宣称稳定。

## 实测证据

- `maxDurationMs=900000`，最终 `stopReason=max_duration`。
- `rateControl=vbv`，`maxRateKbps=3500`，`vbvBufferKbps=7000`。
- `reconnectCount=0`，完成 1 个编码会话。
- 会话时长 `904058ms`，会话输出时间 `890474.667ms`。
- 写入 4463 帧，重复最新帧 1715 次，丢弃 12 个调度间隔，待机帧 2 帧，最后写入帧龄 150ms。
- 会话以 `owner_stop` 结束，调度层以 `max_duration` 结束；退出码 255 出现在有意的 FFmpeg 停止路径，未将该停止当成意外 LIVE。
- 公开播放样本 `sample.avUsable=true`：视频 30 帧、间隔 P50/P95 为 200ms；音频 282 帧、间隔约 21ms；起始差 0ms、持续时长差 195ms、无非单调时间戳，`alerts=[]`。
- 测试中出现的一次探测错误没有覆盖此前和之后的真实验证证据；停止后不再把历史 `lastVerifiedAt` 当作当前 LIVE。

证据保存在 `data/artifacts/stream-vbv-15min.json` 与 `playback-timing-sample.flv`。`recentSessions` 是当前/最近编码会话，不是整场累计；`frames` 才是源帧累计。FFmpeg `speed` 是处理速度，不是独立的网络测速。

## OneBot 验收

- 只读诊断确认 token 一致、只有一个 Agent 进程，WS 握手可建立。
- `get_status` 返回 `online=true、good=true`，WebUI `auth/state=ready`，Agent `/qq/status=ready`。
- 恢复期间没有重启 WSL，boot id 和 NapCat 启动时间保持不变。
- 测试后曾再次出现 `auth_required`，通过重新扫码恢复；当前 ready 不是永久登录凭证或长期会话保证。

## 边界

- 这是本次有效会话的 15 分钟验证，不是所有网络环境都不缓冲的承诺。
- VBV 限制码率峰值，不要求静态画面达到目标码率。
- 音频帧存在和音画时间差不等于非静音语义验证，也不证明官方“大肥鱼”音色。
- 公开验证完成后输出停止，`autonomous=off` 保持不变，不自动恢复公开推流。
