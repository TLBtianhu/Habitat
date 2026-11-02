# Voice Library：音色库应用与语音自主权

> 2026-11-01 · 文字动作与语音动作分离。大肥鱼可以在主人允许的音色范围内，选择是否发声以及使用哪个音色。

## 1. 应用边界

`voice.library` 是系统级 AppSession，不依赖 LLM、Desktop、QQ、B 站或 MC。它提供：

- VoiceProfile 清单、用途、启用状态、后端与可用性；
- 按 Utterance 选择音色，不需要重启 Voice Server；
- 新语音的生命周期与资源管理；
- 文字版状态声明，默认 `surface=false`，不强制在桌面开窗口。

当前音色分为 `identity / roleplay / test`。没有授权声音资产前，只能使用 `test`，不能伪造 `dafeiyu/main` 身份音色。

## 2. 两个动作

```jsonc
// 只生成系统文字，不创建 Utterance
{ "verb": "system.say", "args": { "text": "只发文字" } }

// 生成文字，并选择音色生成语音
{
  "verb": "voice.speak",
  "args": {
    "text": "同时发文字和语音",
    "voiceProfile": "generic/kokoro-zf-xiaoxiao",
    "delivery": ["console"],
    "priority": "normal"
  }
}

// 给已有的大肥鱼消息补语音，不重复发文字
{
  "verb": "voice.speak",
  "args": { "messageId": 42, "voiceProfile": "generic/kokoro-zf-xiaobei" }
}
```

使用 `messageId` 时，Voice Server 从 `system.chat` 取原文，并只允许合成 `dafeiyu` 自己的消息，避免文本分叉或把主人留言误读成她的话。

## 3. 权限

大肥鱼可以：

- 选择 `system.say` 或 `voice.speak`；
- 在 `enabled=true` 的 VoiceProfile 中选择音色；
- 选择投递目标和优先级。

主人保留：

- 安装、删除、启用、禁用 VoiceProfile；
- 制作或更换 `identity` 主音色；
- 授权参考音频、声音资产与发布范围；
- 是否允许自动发声以及公开传播。

Agent 只能提交逻辑 VoiceProfile id，不能传任意模型路径或修改音色资产。

## 4. 生命周期

- `voice.library=open`：允许创建 Utterance 和按需合成；
- `voice.library=closed`：拒绝新的 Utterance 和新的合成；
- 已经生成的缓存音频与历史 VoiceProfile 标签不因关闭或切换后端而丢失；
- 文字系统对话不受音色库开关影响。

## 5. 当前实现与验收

- `voice/library.mjs`：音色清单、启用状态与后端选择；
- 三个 Kokoro VoiceProfile：`zf_xiaobei / zf_xiaoni / zf_xiaoxiao`；
- espeak 备用音色保留但默认禁用；
- Agent obs 中提供 `voice.profiles`，动作白名单新增 `voice.speak`；
- 已验证 Agent 主动选择 `zf_xiaoxiao`、`system.say` 不生成语音、关闭音色库返回 409、缓存与历史音色标签正确恢复；
- 主人可通过 `POST /profiles/default` 修改默认音色，Agent 无权修改；默认值持久化到 `/etc/habitat/voice.json`，重启后恢复；
- 主人可通过 `POST /profiles/sample` 生成试听，试听不发系统聊天；控制台提供音色下拉框和试听按钮，已验证真实播放。
