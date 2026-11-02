# 本地神经 TTS 调研与 Kokoro 落地

> 2026-11-01 · 目标：替换只能做管线验证的 espeak-ng 共振峰合成，使用现代神经网络 TTS。

## 1. 大肥鱼专属音色检索

检索了“大肥鱼 TTS / GPT-SoVITS / DeepSeek 大肥鱼语音 / 溟月 TTS / 鲸鱼娘音色”等方向，并检查现有角色资料。当前没有找到可确认来源的大肥鱼官方或社区公开专属音色包；现有 `docs/research/character.md` 与资产包只有视觉形象，没有授权声音资产。

结论：不能把任意中文女声直接命名为“大肥鱼音色”。先使用明确标注的现代神经测试音色，后续如有授权参考音频，再制作独立 VoiceProfile。

## 2. 选择 Kokoro + sherpa-onnx

官方资料：

- Kokoro 模型与中文说话人说明：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
- sherpa-onnx：https://github.com/k2-fsa/sherpa-onnx
- 模型包：https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2

选择理由：

- Kokoro 82M 神经网络 TTS，支持中文与英文；
- ONNX CPU 推理，不需要本地 LLM、PyTorch 或 GPU 显存；
- `model.onnx` 约 311MB，`voices.bin` 约 27MB；
- 模型包内 LICENSE 为 Apache-2.0；
- 多个中文预置音色可比较，默认 `zf_xiaoni`，不是大肥鱼专属音色。

MeloTTS 也有成熟的 sherpa-onnx 中文模型（约 163MB），可作为后续对照；本次先采用延迟和多音色更合适的 Kokoro。

## 3. 实测（本机 WSL，4 线程）

同一中文文本，三个说话人：

| ID | 音色 | 推理时间 / 音频时长 | RTF | 峰值 RSS |
|---|---|---|---|---|
| 45 | `zf_xiaobei` | 1.413s / 7.789s | 0.181 | 约 647MB |
| 46 | `zf_xiaoni` | 1.275s / 6.940s | 0.184 | 约 640MB |
| 47 | `zf_xiaoxiao` | 1.018s / 6.200s | 0.164 | 约 641MB |

输出为 PCM16 单声道 24000Hz。无 GPU 占用。

## 4. 安装与校验

- 模型：`/var/lib/habitat/models/tts/kokoro-multi-lang-v1_0/`
- 运行时：`/opt/habitat/runtime/tts-venv/`，sherpa-onnx 2.0.1 CPU
- 下载包 SHA256：`60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4`
- 安装清单：`runtime/kokoro-tts.json`
- 显式安装脚本：`tools/install-kokoro.sh`，普通升级不自动下载模型。

Voice Server 已增加可插拔后端：Kokoro 默认，espeak-ng 保留为轻量备用。Utterance、缓存、控制台播放协议不变；历史 Utterance 保存各自 VoiceProfile，切换后端不会篡改旧音色标签。

## 5. 仍未完成

- 这些样本不是大肥鱼专属音色；
- 授权参考声音采集、专属 VoiceProfile、音色相似度评审尚未进行；
- 当前是整段文本合成，尚未做流式首段输出和多总线混音；
- 单语音总线的连续 Audio Mixer 与 HLS AAC 已落地并通过真实语音验证。
