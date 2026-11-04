# ADR-031: SceneRecorder 统一录制与输出

日期：2026-11-04
状态：Accepted（统一帧、输出生命周期和真实桌面/FFmpeg 验收通过）

## 决策

B 站和控制台不各自从桌面抓帧、渲染和编码。统一 `SceneRecorder` 只订阅 Compositor 的 CaptureSession，分配统一 `seq`、`capturedAt` 和 `ptsMs`，再把同一个 `FramePacket` 分发给输出端。

这里录制的是 Habitat 的虚拟 Scene，不是宿主机 Windows 桌面，不抓宿主机屏幕，也不控制宿主机输入。

```text
Compositor CaptureSession
        ↓
  SceneRecorder / FrameClock
        ↓
  统一 FramePacket
        ↓
 ┌──────────────────────┐
 │ BilibiliRtmpOutput   │
 │ ConsolePreviewOutput │
 └──────────────────────┘
```

## 输出职责

- `BilibiliRtmpOutput`：使用 FFmpeg 编码，只有显式启动才连接目标；没有公网自动启动。RTMP 地址和 streamKey 由 owner 在控制台配置，streamKey 只写不回显；输入可为裸 streamname、`streamname=...`、`?streamname=...` 或完整 RTMP URL，统一生成 `.../?streamname=...`。`applied` 表示输出运行，`verified` 只能来自独立播放验证，不能由配置存在或 FFmpeg 启动推断。意外退出使用有限退避重连，owner 停止后不得自动重开；静音 AAC 只是传输兼容音轨，不代表大肥鱼语音。
- `ConsolePreviewOutput`：owner-only HTTP 预览，使用同一份帧包，不重新渲染，不是公开直播服务。控制台 Live 页由 `ScenePreviewService` 提供 owner 主动启停，未启动时保留原 HLS 回退；图像通过控制面同源 `/scene/frame` 返回，避免跨端口预检和 URL 中的 token。
- 输出可以分别 `start/push/stop/status`，一个输出失败不会阻断其他输出；故障移除后录制器可以恢复 `running`。
- `starting`、运行、失败、停止中、已停止分开。FFmpeg 未确认退出时不得报告 stopped。

## 独立播放验证

`PlaybackVerifier` 与推流输出解耦：读取公开房间信息和播放地址，使用独立 FFmpeg 解码一帧。推流运行期间定时验证，控制台“刷新状态”调用同一个 `verifyNow()`，进行中的检查复用，不重复创建解码进程。

- `lastCheckedAt` 是最近检查时间，`lastVerifiedAt` 是最近成功证据时间。
- `verified` 只在当前输出运行且最近成功证据未过期时成立；过期为 `stale`，失败为 `degraded`，输出停止为 `stopped`。
- 不使用旧的 `liveStatus`、旧播放地址或 FFmpeg 进程存活证明当前直播成功。
- `stream/verify-playback-live.mjs` 只读验证真实直播，不启动第二个推流输出。

## 帧规则

- `FrameClock` 驱动统一捕获，序号重复或回退的帧不重复分发。
- 每个包保留真实捕获时间和单调递增的 `ptsMs`。
- 输出启动较晚时可以错过启动前的帧，不伪造补帧。
- 当前先复用已有 Compositor，不引入 OBS Studio。FFmpeg 是当前编码器，未来如确有需要再评估 libobs。
- 音频统一 AudioGraph、QQ 屏幕共享和公网 B 站启用属于后续独立工作，不在本次验收中假装完成。

## 验证

- `stream/verify-scene-recorder.mjs`：重复帧去重、同一份帧数据与 PTS、输出独立启停、故障隔离和 FFmpeg 生命周期。
- `stream/verify-playback-verifier.mjs`：验证合并刷新、成功/失败、过期恢复、停止和周期清理。
- `stream/verify-rtmp-reconnect.mjs`：意外退出退避重连、静音 AAC、错误脱敏和 owner 停止。
- `stream/verify-bilibili-live.mjs`：RTMP 配置脱敏、输出启停、更新隔离与 verified 状态。
- `control/verify-bilibili-settings.mjs`：owner 配置保存、非法地址拒绝、密钥保留和 Live 配置页。
- `control/verify-scene-preview.mjs`：owner 预览启停、授权图像、重启和 Live 页面回退。
- `stream/verify-scene-live.mjs`：真实桌面 CaptureSession、owner 预览和本地 FFmpeg 文件输出，验证编码帧数，不连接公网 RTMP。
- 本地文件验收不是直播成功证明；公网推流仍需 owner 明确启动并单独验证。
