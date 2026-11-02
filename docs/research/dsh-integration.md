# 自研 AgentLoop 与 DSH 集成方式复核

> 2026-11-02 · 依据 Habitat 当前实现、DHS 0.2.1-rc.2 本地包文档与开源 Agent 集成方式。
> 本文件只做架构决策，不代表已经接入真实 DSH。

## 1. 当前自研实现的集成程度

### 已经是产品级边界的部分

- AppSession 是应用声明真源，obs、Desktop、Outlet 是投影；
- Desktop/Display 合成、Voice Library、Audio Mixer、HLS/RTMP 编码与推送分进程；
- MC、QQ、B站、system.chat、voice.speak 使用不同命名空间；
- 捕获权限、短期 token、Outlet 进程监督、正常停机和恢复已实测；
- AgentLoop 通过闭集 `system.say / voice.speak / app.* / mc.*` 驱动客户端，攻击面小、实时行为容易审计。

### 仍然很薄的部分

当前 `agent/agent-loop.mjs` 每轮至多产生一个 intent，`run-continuous.mjs` 手工拼装 obs 并直接路由到客户端。它缺少：

- 完整 turn/step、多工具调用与并发控制；
- 可恢复 Session log、projection 和 replay；
- 自动上下文压缩、模型请求生命周期和可靠取消；
- 标准技能/MCP/插件生态、工作流、子代理、任务和批准体系；
- 长期目标、复杂编码任务和跨应用编排能力。

`Memory` 目前主要是进程内衰减记忆，不能替代 DSH 的持久化会话。闭集动作仍然应该保留，不能为了“换成 DSH”把这些边界删掉。

## 2. 自研 AgentLoop 与 DSH 的差异

| 维度 | Habitat 自研 AgentLoop | DSH |
|---|---|---|
| 驱动方式 | 定时 tick + 单 intent | turn/step + 模型请求 + 多工具执行 |
| 实时性 | 轻、确定、适合直播心跳 | 一轮可能很长，需要任务边界和取消 |
| 动作面 | 少量闭集动词 | 文件、Shell、Web、MCP、子代理等可扩展工具 |
| 状态 | AppSession + 少量 JSONL/快照 | Session log、projection、恢复、压缩、写入屏障 |
| 权限 | 领域权限简单明确 | 完整沙箱/工具政策，但默认能力远大于直播需要 |
| 生态 | 手写客户端适配器 | profile、bundle、plugin、SDK、MCP |
| 人格 | Habitat Persona/VoiceProfile | 部署 persona 与持久 Session，需单独隔离 |
| 停机 | 领域服务已做正常退出 | 需先 drain Agent，根退出并不保证末尾事件已持久化 |

### 自研的优势不能丢

- 直播实时性和闭集动作比“通用能力多”更重要；
- AppSession/Desktop/Voice/Outlet 已经是正确的系统骨架；
- 领域适配器和错误语义已经过真实故障验证。

### DSH 的真实优势

- 生产级 turn/step、工具调度、取消、持久化与恢复；
- prompt assembly、compaction、session projection、subagent/job/goal；
- 插件/profile 生态和 Linux/headless 运行方式；
- 对复杂编码、研究、多步骤任务，比继续补自研循环更划算。

### DSH 不是直接替代品

- `dsh-headless` 是**一次任务后退出**的 one-shot runner，不是持续在线人格；
- DSH 默认工具可能写文件、执行 Shell、联网和派生子任务，不能直接开放给弹幕驱动的大肥鱼；
- `sdk-minimal` 有持久 Shell 且默认 `danger-full-access`，不适合拿来做直播人格的快捷入口；
- DSH 的 Session、工具历史与 Habitat 的 AppSession/Phase 不是同一层，不能互相替代。

## 3. 别的 Agent 集成最容易踩的坑

1. **两个循环嵌套**：框架的 turn loop 与直播 heartbeat 同时决定动作，造成重复回复、重入和不可控的连续工作。
2. **默认权限继承**：直接使用 base/sdk 的 Shell、文件、Web 和子代理，弹幕提示词注入因此变成真实系统操作。
3. **GUI/headless 误配**：one-shot 运行成功就宣称“持续在线完成”，实际进程已退出，后续状态没人维护。
4. **状态串号**：共享 home、Session id、workspace、缓存、插件目录、模型选择、AGENTS.md、凭证和遥测，导致原版 DSH 与大肥鱼互相污染。
5. **Worker 当沙箱**：Node Worker、VM 或 WSL 本身不是完整安全边界。文件写入策略也不等于网络/进程/凭证隔离。
6. **accepted 当成功**：异步任务被接受不等于终态成功；进程退出时仍可能有未完成工具调用或末尾事件未写入。
7. **非幂等重试**：模型或框架重试导致重复发言、重复推流、重复下载和重复修改世界。
8. **长 turn 阻塞实时系统**：观众事件不断到达，Agent 还在执行长工具链，导致画面、语音和控制面失去时效。
9. **恢复旧人格/旧权限**：Session 恢复带回了过期的指令、workspace、工具组合或模型配置，造成“看起来记得，实际做 wrong job”。
10. **上下文压缩副作用**：压缩改变提示与缓存，若人格和权限没有固定，可能把旧的错误目标也保留下来。
11. **插件生命周期泄漏**：注册没有在 agent/plugin dispose 时清理，HMR 或回滚后残留旧工具和旧事件监听。
12. ** stdout/协议污染**：SDK 插件向 stdout 写普通文本，JSON-RPC 直接损坏；Web profile 还会引入不需要的端口和 GUI 依赖。
13. **默认凭证和外部遥测**：意外使用原版 DSH 的登录态、凭证或 Session-log 上传，既串账号又可能泄露对话。
14. **演示当验收**：示例项目里的模拟聊天和假成功不能证明真实沙箱、真实插件、真实安装或真实故障恢复。

MCP 官方安全建议也提醒要处理 confused deputy、token passthrough、SSRF 和本地 Server  compromise；开源工具接入不是“有协议就安全”。

## 4. 决策：成品规范扩展，不做源码 fork

**不直接源码魔改一个新的 DSH。** 优先使用官方 `dsh-base`、profile patch、独立插件包和公开 `ctx.agents` 生命周期。

原因：

- DSH 已提供 profile/bundle 的正式扩展点，源码 fork 只会增加版本冲突和升级成本；
- Habitat 需要的是 DSH 的认知驱动，不是替换 DSH 的桌面产品；
- 公开 `ctx.agents.create()/resume()` 支持 scoped persona 和工具组合，声明式 config agent 没有独立的 per-agent persona/setup，正适合通过 Host 插件接入；
- 只有证明某个必需 API 不存在时，才评估补丁；优先做上游兼容插件，而不是另起一个同名产品。

## 5. 保留两个层级，不要两个决策者

```text
Habitat heartbeat（事件接入、时效、相位、预算）
  → DSH Agent Driver（有界 turn：理解/规划/工具）
  → 结构化 intent（闭集）
  → Habitat Broker（权限复核、幂等、执行、终态）
```

- Habitat 决定何时唤醒、是否取消、哪些应用事件可进入；
- DSH 只在有界任务内推理和调用受限工具，不直接控制 Desktop、Outlet、QQ/MC 或宿主；
- DSH turn 不等于 Habitat Phase；PhaseMachine 仍是系统相位真源；
- `llm-provider` 可以被 DSH driver 替代，AppSession/Broker/客户端不需要重写。

首个验证只用 `system.chat` 和 `voice.speak`，不开放 Shell、文件写入、Web、子代理或公开推流。`dsh-headless` 只用于验证真实运行时，不作为最终持续在线形态。

## 6. 与 Windows 原版 DSH 的隔离契约

用户本来就有 DSH 时，必须做到**安装、配置、会话、凭证、插件、进程全部不串**：

### 安装与版本

- Habitat 使用自己固定版本、固定哈希的 DSH runtime，不读取原版的安装目录或 `node_modules`；
- 不修改原版 DSH、原版 profile 或全局 `cordis.patch.yml`；
- 不对原版执行 `dsh plugin`、profile reset、插件启停或版本豁免；
- 开发、便携、安装三种形态各有独立 runtime root 和 data root。

### Profile 与 home

- 使用独立 profile 名，例如 `habitat`，绝不使用 Electron 保留的 `desktop`；
- 设置独立 `DSH_HOME` 和 `DSH_AGENTS_HOME`，不默认读 `~/.dsh` 与 `~/.agents`；
- 只加载 Habitat 自己的 profile patch 和插件，不继承用户全局 AGENTS.md、skills、模型选择和插件；
- 使用稳定 Session id 和固定 workspace/profile，避免 cwd/preset 变化导致恢复拒绝或串会话。

### 凭证与遥测

- 使用 Habitat 自己的 `/etc/habitat/llm.json` 等受保护配置，不恢复原版 managed credential store；
- 不读取原版 `.credentials.yaml`、DeepSeek 登录态或平台 Session；
- 明确关闭不需要的 Session-log 上传和外部遥测；
- owner/agent/capture token 与 DSH 的凭证命名空间分开，不能互换。

### 进程与端口

- 优先 stdio/headless/SDK 驱动，不启动不需要的 Web GUI；
- DSH 的进程、Session log、profile 插件目录与 Habitat 服务分开；
- Habitat 的 9230/9240/9260/9270/9271/9272 等端口不与 DSH GUI 端口复用；
- 停机先 drain DSH Agent，确认 Session flush 后再停 Habitat 服务，不能依赖根进程退出自动保存。

## 7. 建议迁移顺序

1. 独立 `DSH_HOME/DSH_AGENTS_HOME` 下做一次真实 DSH one-shot 启动，证明没有读取原版状态；
2. 用 profile patch 关闭 Shell、Web、子代理、外部遥测和不需要的凭证源；
3. 写最小 Habitat Host/Tool 插件，提供 `system.say`、`voice.speak` 的结构化 intent；
4. 由 Habitat heartbeat 调用 DSH driver，验证有界 turn、取消、恢复和幂等；
5. 再考虑把复杂编码/研究工作流迁入 DSH，通用实时心跳仍留在 Habitat。

## 参考资料

- DSH AgentLoop：`@deepseek-ai/dsh-agent-loop/README.md`
- DSH Headless：`@deepseek-ai/dsh-headless/README.md`
- DSH Base：`@deepseek-ai/dsh-base/README.md`
- DSH SDK Minimal：`@deepseek-ai/dsh-sdk-minimal/README.md`
- DSH home paths：`@deepseek-ai/dsh-home-paths/README.md`
- MCP Security Best Practices：https://modelcontextprotocol.io/docs/draft/tutorials/security/security_best_practices
- OpenHands：https://github.com/OpenHands/OpenHands
- AITuber-onair：https://github.com/shinshin86/aituber-onair
- LangGraph：https://www.langchain.com/langgraph

## 8. 源码删减与架构资料（补充）

DSH 是 MIT 许可，可以拉源码做删减式 fork，但不建议把“删包”当首选：

- 官方架构明确“没有特权核心，产品各层都是插件”，`dsh-base` 只是覆盖空 root 的可 patch 组合；`sdk-minimal` 又证明可以完全独立声明一棵不继承 base 的树；
- 因而 Web/GUI、Shell、子代理、遥测、凭证源等都可以在独立 profile 中不挂载，达到运行时的删减，不需要改源码；
- 直接删源码容易破坏服务依赖、Session 持久化/迁移、插件 engines 约束和测试矩阵，后续还要持续合并上游修复；
- 只有需要改变 turn/step、AgentHandle、Session 事件格式或 ToolExecution 核心语义时，才考虑窄范围源码补丁；优先保持上游 remote 和小 patch，而不是大规模删包。

官方材料：

- 仓库：https://github.com/deepseek-ai/deepseek-harness
- 总体架构：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- 子系统索引：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md
- Agent/Core 循环：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md
- Session 事件模型：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md
- 持久化与崩溃恢复：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md
- 工具管线：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md
- 包分组地图：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md
- 模块依赖图：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md
- 组合结构图：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/composition.md

## 9. QQ/B站/MC 机器人的真实限制方式（补充）

很多机器人不是原生 DSH 集成，而是“协议适配器 + 领域事件/状态 + 小型 Agent 循环 + 白名单输出”。它们限制的不是 DSH 大小，而是**输入、动作、身份和执行域**。

### 典型项目

| 项目 | 集成方式 | 限制方式 |
|---|---|---|
| NoneBot2 | 平台协议适配器 + 异步事件/插件 | 平台事件由适配器归一化，插件只处理匹配事件；不要求通用 Agent/Shell |
| AstrBot | IM 平台 + LLM/Agent/MCP/Skills | 对代码和 Shell 另设 Agent Sandbox，危险执行不与普通消息链路混跑 |
| Open-LLM-VTuber | 模块化 LLM/ASR/TTS/Live2D/Agent 接口 | 角色、语音和模型可配置，Agent 可替换；不是 DSH 内核 |
| Mindcraft | Mineflayer + LLM | 代码编写默认关闭；官方明确警告公网开启代码执行和沙箱逃逸风险，建议容器隔离 |
| mcpfabric（本项目使用） | MC mod 提供结构化 JSON-RPC | 只提供 `player.getState`、`vision.describeScene`、`chat.send`、`control.lookAt` 等领域方法，不提供宿主 Shell |

### 共同的限制层

1. **输入**：QQ 群/直播间/服务器白名单，消息过滤、限频、管理员 ACL；普通消息不自动升级为主人命令。
2. **动作**：优先 `send_message`、读取状态、少量世界动作；默认没有文件系统、Shell、宿主输入和任意网络能力。
3. **身份**：机器人账号、房间、群和 Session 隔离，不能共享主人或其他应用的凭证。
4. **执行**：需要写代码时另起容器/沙箱，不能直接在机器人主进程运行 LLM 生成代码。
5. **生命周期**：事件队列、取消、限频、适配器退出都要有明确所有权，不能留下失控后台任务。
6. **人格与记忆**：按房间/会话区分，不继承全局 DSH_HOME、其他 Agent 的 AGENTS.md 或模型配置。

### 对 Habitat 原生 DSH 集成的启示

- 原生 DSH 集成只能走受支持的 profile/plugin，而不是源码嫁接；做不到这些限制就不如保留闭集 AgentLoop。
- QQ/B站/MC 的领域适配器仍保留现有闭集协议，DSH 只处理有界认知任务，不能直接收到原始弹幕并自由调用工具。
- 默认禁用 Shell、文件写入、Web、子代理和外部遥测；只有独立编码沙箱才允许这些高风险能力，且必须有单独批准。
- 大肥鱼的 Session、凭证、进程、插件目录与 Windows 原版 DSH 完全隔离。
