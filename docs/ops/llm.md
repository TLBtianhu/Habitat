# 心智 LLM 配置

## 当前状态

AgentLoop 已通过 `agent/llm-provider.mjs` 接入真实 OpenAI-compatible provider，并完成控制台系统对话、离线补收与防自回复验收。当前配置仍是单一 provider；本地 llama.cpp、逻辑模型 profile、云端许可与显存预算的下一步边界见 `docs/design/local-intelligence.md`。

## 配置方式

在 `/etc/habitat/llm.json`（开发态可用 `agent/llm.example.json` 作模板）写：

```json
{
  "provider": "openai-compatible",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "secretRef": "llm/deepseek",
  "timeoutMs": 30000,
  "maxTokens": 300,
  "temperature": 0.3
}
```

含义：

- `provider`：目前按 OpenAI-compatible 设计；
- `baseUrl`：API 地址；
- `model`：模型名；
- `secretRef`：**API key 不写在配置文件里**，只写身份引用；
- `timeoutMs/maxTokens/temperature`：推理约束。

## API key 放哪

推荐直接放在本机 `/etc/habitat/llm.json` 的 `apiKey` 字段，**权限 600**：

```json
{
  "provider": "openai-compatible",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "apiKey": "在本机填写，不随包分发",
  "timeoutMs": 30000,
  "maxTokens": 300,
  "temperature": 0.3
}
```

**这个文件是本机配置，不进入分发包。** 也可以在 Identity Hub 里登记为 `llm/deepseek`，方便统一管理；但运行时以本机受保护配置为准。

## 接入后的数据流

```
obs（稀疏观测）
  → 组装 system+user prompt（含相位、能力白名单、记忆摘要）
  → LLM 返回严格 JSON intent
  → policy 校验（动词是否在白名单、参数是否合法）
  → broker 执行
```

**模型不直接执行代码**，只能输出闭集动作，例如：

```json
{ "verb": "walk", "args": { "toward": "oak_log", "distance": 3.2 } }
```

## 下一步

- 在现有 provider 前增加 Model Gateway，Agent 只选择逻辑 profile；
- 增加本地 llama.cpp provider，但不改变现有人格、记忆和动作白名单；
- 本地不可用时的行为由主人配置，禁止未授权静默云端回退；
- 按 `docs/design/local-intelligence.md` 做模型 manifest 与 VRAM/RAM 预检，再决定具体模型。
