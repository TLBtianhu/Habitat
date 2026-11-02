# Voice Server：把"说话"与"发送到哪里"分开

> 2026-11-01 补充：VoiceProfile、本地模型环境与 8GB VRAM 预算见 [local-intelligence.md](local-intelligence.md)。Voice Server 只合成一次 PCM；多出口共享与混流应按该文边界实施。

> 2026-10-31 · 对应问题：QQ 群 TTS 语音与直播间 TTS 语音，如何统一成一个抽象？

## 1. 核心抽象：Utterance 与 Delivery 分离

- **Utterance（言语）**：她此刻想说的一句话，带文本、情绪、音色、语速、优先级；
- **Delivery（投递）**：这句话要去哪里——QQ 群、直播间、私聊、本地播放。

**一句话只生成一次，按目标分别编码投递。**

```ts
type Utterance = {
  id: string;
  text: string;
  mood?: string;
  voice?: string;          // 统一音色 id
  rate?: number;
  targets: Array<
    | { kind: 'qq'; groupId?: string; userId?: string }
    | { kind: 'live'; platform: string }
    | { kind: 'local' }
  >;
  priority?: 'interrupt' | 'normal' | 'background';
};
```

## 2. Voice Server 的职责

```
DSH（SpeechIntent）
   → Voice Server
       ├─ TTS 后端（可插拔/可降级）
       ├─ PCM 母带 + 缓存
       ├─ RMS 包络 → Display Server（口型）
       └─ 按 target 编码投递
              ├─ QQ：OGG/SILK/AMR 语音消息
              ├─ Live：PCM/AAC 音轨进 Outlet
              └─ Local：可选播放
```

**TTS 不是 QQ 或 live 的一部分，正如 Live2D 不是 live 的一部分。**

## 3. 统一音频产物

```ts
type AudioArtifact = {
  utteranceId: string;
  pcm: Buffer;              // 母带，后续所有格式都从它派生
  durationMs: number;
  rms: Array<{ t: number; v: number }>;  // 口型包络
  hash: string;             // 文本+音色+参数的缓存键
};
```

- QQ 需要的是语音消息编码（OGG/SILK/AMR）；
- 直播需要的是连续音轨（PCM/AAC 混流）；
- 口型需要的是 RMS，不是某个客户端的私有数据。

## 4. 投递策略

| 策略 | 含义 |
|---|---|
| `interrupt` | 打断当前语音，适用于紧急说明 |
| `normal` | 排队，按顺序说 |
| `background` | 可被高优先级打断 |

另外：
- **缓存**：相同文本+音色+参数不重复调 TTS；
- **限频**：QQ 群与直播间分别限频；
- **隐私**：QQ 私聊内容不许被顺手投递到直播；
- **降级**：TTS 挂了 → 直播间字幕继续，QQ 退化为文本，不阻塞心智。

## 5. 与 Display Server 的关系

两者是同级服务：

- Display Server 负责**画面**（形象、字幕、场景）；
- Voice Server 负责**声音**（TTS、编码、投递、RMS）。

直播间里，Outlet 把 Display 的视频轨与 Voice 的音频轨合成；QQ 里，Display 与 Voice 可以完全分开使用。

## 6. 一句话

> **她只"说一次"，Voice Server 决定这句话在 QQ 里是一条语音，还是在直播间里是一段音轨。**
