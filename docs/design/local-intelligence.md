# 本地智能运行时：LLM、人格、音色与音频环境

> 2026-11-01 · 目标：本地 TTS、大肥鱼音色与本地/远程 LLM 都能替换，但不互相绑架。
> 本机约束：RTX 5060 Laptop 8GB VRAM、WSL 内存 15GB。

> **边界澄清：本地 TTS 不需要本地 LLM。** 当前大模型继续生成文字，TTS 只负责文字→音频。Model Gateway / 本地 LLM 是独立的可选离线心智路线，不属于本次语音落地的前置条件。

## 1. 四个对象，不是一团“模型环境”

| 对象 | 拥有什么 | 不应该拥有什么 |
|---|---|---|
| **Model Runtime** | LLM 推理进程、权重、上下文与后端配置 | 大肥鱼人格、音色、聊天历史 |
| **PersonaProfile** | 大肥鱼的人格提示、行为边界、记忆引用 | 某个具体模型的权重或 API key |
| **VoiceProfile** | 经授权的参考音频、文本、音色参数、版本与许可 | LLM、直播间、QQ 或 Desktop |
| **Delivery / Audio Outlet** | 本地播放、AAC、QQ 编码、直播混流 | 决定说什么、伪造音色或重新合成 |

替换 LLM 不应改变大肥鱼人格与音色；替换音色后端不应改变聊天与直播协议。

## 2. 服务边界

```text
                    ┌──► Model Gateway ──► 本地 llama.cpp / 远程 OpenAI-compatible
AgentLoop ──obs─────┘                         （推理实现可替换）

AgentLoop ──system.say──► 控制台文字立即可见
                   │
                   └─► Utterance ─► Voice Server ─► PCM 母带 + SpeechEvent
                                                   │
                                                   ▼
                                              Audio Mixer
                                                   │
                                      ┌────────────┼────────────┐
                                      ▼            ▼            ▼
                                  本地播放       HLS/RTMP      其他音频出口

Desktop 只消费可选的 SpeechEvent（说话状态、RMS/口型），不负责生成声音。
```

- 一句话有稳定 `utteranceId`，文字、音频、口型和投递状态可以关联；
- 同一句话只合成一次 PCM，多个出口共享，不能每个出口各调一次 TTS；
- 没有音频消费者时，文字对话照常，不强制生产音频；
- TTS 失败不能阻塞文字与 AgentLoop，也不能自动改成云端音色。

## 3. Model Gateway 与 LLM 环境

Agent 只请求逻辑 profile，例如 `conversation.fast`、`reasoning.deep`、`embedding.local`，不直接持模型路径或推理密钥。

Model Gateway 负责：

- 选择本地或远程 provider；
- 超时、排队、并发限制、错误报告；
- 记录当前实际模型与后端，供控制台显示；
- 执行隐私策略：`allowRemote=false` 时，本地模型不可用就明确失败，绝不静默上云。

**参考本地运行时**：llama.cpp server。它能放在独立进程里，以 OpenAI-compatible 接口服务，现有 Agent 的 provider 不需要和推理实现编译在一起。远程 DeepSeek 等 provider 仍保留为主人显式选择的配置，不因“支持本地”而删除。

模型权重使用独立 manifest：id、版本、文件、SHA256、量化、上下文、后端、许可、VRAM/RAM 预算。人格提示不属于模型包。

## 4. VoiceProfile：大肥鱼音色是一等身份资产

通用 TTS 模型不会自动等于“大肥鱼音色”。VoiceProfile 至少需要：

```jsonc
{
  "id": "dafeiyu/main",
  "version": "0.1.0",
  "backend": "<gpt-sovits | cosyvoice | other>",
  "referenceAudio": "voice/dafeiyu/reference.wav",
  "referenceText": "<与参考音频对应的文本>",
  "assetLicense": "<授权与再分发范围>",
  "baseModel": "<模型 manifest id + sha256>",
  "prosody": { "rate": 1.0, "pitch": 0, "style": "default" },
  "reviewSamples": ["voice/dafeiyu/review/001.wav"]
}
```

要求：

- 参考音频与训练样本必须来源清楚、获得授权；
- 音色更新像身份升级一样由主人批准，不能由观众提示词或普通应用事件修改；
- 保留固定验收文本与样本，便于比较“像不像大肥鱼”，而不只是能不能发声；
- 未获得合格声音资产前，只能标注“通用测试音色”，不能命名为大肥鱼音色。

## 5. TTS 后端选型门槛

- **Piper**：适合验证本地语音链路、PCM 母带、播放与混流，因为轻量、快；通用声音不自动代表大肥鱼。
- **GPT-SoVITS / CosyVoice**：作为中文定制音色候选，必须实测后再选，不按热度锁死。

验收必须同时比较：

1. 中文可懂度与自然度；
2. 与授权参考声音的相似度；
3. 首段音频延迟与持续合成速度；
4. WSL 当前 GPU/驱动/PyTorch 后端兼容性；
5. VRAM、RAM、磁盘占用；
6. 模型与音色资产的许可。

## 6. 8GB VRAM 的资源纪律

不能默认“7B LLM + 大型 TTS”同时常驻：

- Model Runtime Manager 在加载前做 VRAM/RAM/磁盘预检；
- 默认只允许一个重型 GPU 加载/初始化任务，避免并发把显存打爆；
- LLM 的权重与 KV context 都必须计入预算，不能只算 GGUF 文件大小；
- TTS 可按需加载，但只有在预算允许时启用；预算不足应明确拒绝或选择主人批准的 CPU/小模型路径；
- 不允许为了省显存，未经同意把推理切到云端；
- Desktop 视频编码与浏览器也占资源，不能按“显存全部给模型”规划。

本机先测量，再决定具体 LLM 尺寸和 TTS 常驻方式。

## 7. 目录与发行边界

```text
/opt/habitat/app/                    # 只读程序，不含大模型
/etc/habitat/llm.json                # 主人 provider / key / 云端许可
/etc/habitat/voice.json              # 当前 VoiceProfile 选择
/var/lib/habitat/models/llm/         # 独立管理的 LLM 权重与 manifest
/var/lib/habitat/models/tts/         # TTS 基础模型
/var/lib/habitat/voice/dafeiyu/      # 大肥鱼授权声音资产与 VoiceProfile
/var/lib/habitat/cache/tts/          # 可删除的 PCM 缓存
/var/lib/habitat/system-chat.jsonl   # 用户对话，升级保留
```

模型、音色、配置和用户数据独立升级。大型模型下载与激活都需要主人确认。

## 8. 推荐落地顺序（语音优先）

1. 只做 TTS 后端/显存探测和 Voice manifest，不下载大模型，也不建设本地 LLM；
2. 建 Voice Server 与 PCM/Utterance 接口，用明确标注的通用测试音色验收本地播放；
3. 有授权声音资产后，制作并评审 `dafeiyu/main`；
4. 接 Audio Mixer、AAC 与直播音轨，不把音频塞回 Desktop；
5. 现有远程 LLM 保持不变。只有将来明确需要离线心智时，才单独评估 Model Gateway 与本地 LLM。

## 9. 当前已实现（语音优先，2026-11-01）

- `voice/server.mjs`：独立 Voice Server，`127.0.0.1:9270`；
- `voice/profiles/kokoro-xiaoni.json`：默认 Kokoro 中文神经测试音色；`generic-espeak.json` 仅作备用，二者都不是大肥鱼专属音色；
- `POST /utterances` 只创建声明，需要 agent token，不立即合成；
- `GET /utterances/:id/audio` 第一次被消费者拉取时才调用当前 TTS 后端，生成 PCM16 WAV；
- 后端可插拔：Kokoro 82M + sherpa-onnx CPU 为默认，espeak-ng 为备用；模型 manifest 在 `runtime/kokoro-tts.json`；
- WAV 的 RIFF/data 长度会规范化，音频保存到 `/var/lib/habitat/cache/tts/`；
- Utterance 与状态追加保存到 `/var/lib/habitat/utterances.jsonl`，Voice Server 重启后恢复 id、状态和可用缓存；
- `voice.library` 是独立 AppSession，`voice/library.mjs` 提供多个 VoiceProfile 的清单、启用状态与按 Utterance 后端选择；
- `system.say` 只发文字；`voice.speak` 才创建 Utterance，可选择音色或引用已有 `messageId` 补语音，关闭音色库会拒绝新合成；
- 控制台必须由用户点击“开启声音”，之后通过 Web Audio 拉取并顺序播放新回复；未开启时不生产音频。

- `audio/mixer-service.mjs`：独立连续音轨服务，`127.0.0.1:9271`；有捕获者才拉取 Utterance 音频，统一为 48kHz 双声道 PCM，多个捕获者共享转换结果；
- HLS Outlet 同时订阅 Desktop 视频和 Audio Mixer 音轨，编码 H.264 + AAC，彼此仍不合并渲染或语音职责。

已验证：按需合成、缓存复用、真实 Agent + Kokoro 回复播放、播放队列结束、Voice 重启恢复、连续静音/语音 PCM，以及本地 HLS 流内真实 AAC 语音。

**尚未实现**：大肥鱼授权 VoiceProfile、流式首段合成、多总线混音与口型事件。当前连续混音是单语音总线加静音；专属音色仍需授权声音资产。

## 参考实现

- llama.cpp：https://github.com/ggml-org/llama.cpp
- GPT-SoVITS：https://github.com/RVC-Boss/GPT-SoVITS
- CosyVoice：https://github.com/FunAudioLLM/CosyVoice
- Piper：https://github.com/rhasspy/piper
