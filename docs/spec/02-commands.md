# SPEC-02 意图、动词与政策闸门（冻结候选）

> 版本：v0.1 草案 · 状态：待审
> 上位律：`READING.md` D1（边境检查站）、D4（树只在装配期）、C2（稳与安分家）
> 接缝：[SPEC-01 事件](01-events.md) → 本规格 → [SPEC-03 相位] / [SPEC-04 场景]
> 一句话：**观众能说话，不能下命令；她能动，但每一下都要能被审计。**

---

## 1. 目的与边界

本规格定义**系统的全部动作面**：有哪些动词、参数长什么样、谁能发起、经过哪道闸门、怎么记录、失败怎么办。

它**不**定义：动作怎么被渲染（SPEC-04）、相位怎么切（SPEC-03）、插件怎么热更（SPEC-06）。

---

## 2. 命令动词集（闭集，11 个）

**C-1** 动词集是**闭集**。加一个动词 = 改核心 = 必须走版本号 + 迁移，**她不能改**。她的表达力靠参数与组合，不靠添动词。

| # | 动词 | 参数 | 能力 | 最低权限 | 谁能发起 |
|---|---|---|---|---|---|
| 1 | `walk` | `to: Vec3\|TargetRef`, `within?: number` | `mc.moveTo` | L2 | 她 / 人工 |
| 2 | `dig` | `block: BlockPos`, `count?: number` | `mc.dig` | L2 | 她 / 人工 |
| 3 | `place` | `block: BlockRef`, `at: BlockPos` | `mc.place` | L2 | 她 / 人工 |
| 4 | `look` | `at: Vec3\|EntityRef`, `durationMs?: number` | `mc.look` | L1 | 她 / 人工 |
| 5 | `say` | `text: TrustedText`, `channel: 'voice'\|'chat'\|'both'` | `voice.say` / `chat.send` | L2 | 她 / 人工 |
| 6 | `play_media` | `ref: MediaRef`, `volume?: number` | `media.play` | L3 | 她（需闸门）/ 人工 |
| 7 | `switch_scene` | `scene: SceneId`, `transition?: TransitionRef` | `stage.switch` | L3 | 她（需闸门）/ 人工 |
| 8 | `idle` | `pose?: PoseRef`, `forMs?: number` | `stage.idle` | L1 | 她 |
| 9 | `start_stream` | `platforms: PlatformId[]` | `stream.start` | L3 | **仅人工** |
| 10 | `stop_stream` | `reason: string` | `stream.stop` | L3 | 人工随时；**她仅 ENDING 相位** |
| 11 | `handover` | `mode: 'takeover'\|'resume'` | `system.handover` | L3 | **仅人工** |

**C-2** `handover` 与 `start_stream` **严禁**由 agent 发起；类型上不接受这两个动词的 `AgentCommand` 构造。

**C-3** 每个动词**必须**有：参数 schema、能力名、超时、幂等语义、取消语义、失败语义。缺一项不许进动词表。

---

## 3. 权限阶梯（五级，对应 MEMORY L446）

| 级 | 含义 | 例子 | 闸门要求 |
|---|---|---|---|
| L0 | 只读观察 | 看弹幕、读状态 | 无（不进命令日志） |
| L1 | 改数值/局部状态 | `look`、`idle`、音量 | 置信度 ≥ 0.6 |
| L2 | 改动作/说话 | `walk`、`dig`、`say` | 置信度 ≥ 0.85 + 相位允许 |
| L3 | 改部署/对外可见 | 切场景、放视频、开播 | 置信度 ≥ 0.85 + **来源不得为 untrusted** |
| L4 | 改代码（热更） | 装插件 | **仅人工批准**，见 SPEC-06 |
| L5 | 改核心 | —— | 不存在 |

**C-4** `untrusted` 来源**严禁**直接触发 L3 及以上命令。观众说"放个视频"只能生成**候选**，最终由她（或人工）批准。

---

## 4. 意图闸门（唯一文本→动作的通道）

### 4.1 三段式

```
UntrustedText + Context
   │
   ├─① 规则段（确定性、便宜、可解释）
   │    正则/关键词/槽位 → Candidate[]（或空）
   │
   ├─② 模型段（只在需要时调用）
   │    输入：围栏上下文 + Candidate[] + 动词 schema
   │    输出：IntentResult | IntentRejected
   │
   └─③ 政策段（纯函数，无模型）
        能力 + 相位 + 配额 + 信任 → Allow / Deny(reason)
```

**C-5** 规则段**必须**先跑。命中唯一候选且置信度 ≥ 0.95 时**可**跳过模型段（省成本、可预测）。
**C-6** 模型段**严禁**直接产出 `Command`；它只产出 `IntentResult{verb, args, confidence, evidence}`，由政策段裁决。
**C-7** 政策段**必须**是纯函数（同样的 `(intent, phase, quota, trust)` 必得同样的裁决），以便重放与测试。

### 4.2 置信度分档

| 区间 | 行为 |
|---|---|
| < 0.6 | **不动作**；只记录；她**可**说一句"我看看" |
| 0.6–0.85 | 只允许 L0/L1 |
| ≥ 0.85 | 允许 L2；L3 还需来源非 untrusted |
| 参数越界/类型不符 | **一律拒绝**，不论置信度 |

**C-8** "拿不准就不做"是默认值；**严禁**为了显得敏捷而降低阈值。

### 4.3 拒绝语义

```ts
type IntentRejected = {
  reason: 'low_confidence' | 'no_capability' | 'wrong_phase'
        | 'quota' | 'unsafe_arg' | 'trust_too_low'
        | 'human_control';   // 由 SPEC-03 §6 补充：人工接管期间拒一切 agent 命令
  evidence: EventId[];
  at: number;
};
```

**C-9** 每次拒绝**必须**落日志并可观测（计数 + 最近 10 条可查）。
**C-10** 她**可以**对拒绝作出解释（那是一次 `say`），但**严禁**把拒绝伪装成"没看见"。

---

## 5. 参数世界（类型级白名单）

```ts
type ArgValue =
  | number | boolean
  | Vec3 | BlockPos | BlockRef | EntityRef | TargetRef
  | MediaRef          // 只能来自白名单媒体表，不接受任意 URL
  | SceneId | PoseRef | TransitionRef
  | TrustedText;      // 仅 say.text 可用
```

**C-11** `ArgValue` 中**不存在** `string`（裸字符串）、`Path`、`Url`、`Shell` 这些类型。**不是"禁止使用"，是类型上就没有**。
**C-12** `MediaRef` **必须**由媒体表解析（本地文件或已审核 URL），**严禁**由模型生成 URL 字符串。
**C-13** 参数校验**必须**在政策段完成；校验失败 = `unsafe_arg` 拒绝，**严禁**"尽力而为地修正"。

---

## 6. 命令日志（与插件计算分家）

**C-14** 命令日志是 **append-only** 的 `commands-YYYYMMDD.jsonl`，字段冻结：

```ts
type CommandRecord = {
  commandId: string;     // ulid，幂等键
  verb: Verb;
  argsHash: string;      // 参数哈希，不存明文（say 的文本另存加密旁路）
  source: 'agent' | 'human' | 'system';
  trust: Trust;
  evidence: EventId[];
  phase: Phase;
  result: 'ok' | 'timeout' | 'cancelled' | 'failed';
  at: number;
};
```

**C-15** **插件严禁写命令日志。** broker 不提供该能力；插件只能调用动词，由泵记账。
**C-16** 命令日志与事件日志**必须**能用同一时间轴对齐（都用 `at` + `seq`），以便"她为什么这么做"可回查。

> 这条对应 MEMORY L764 的 ccb/cbb 分家：**命令是闭集记录（可回放），插件是开放计算（可热换）**。一旦插件能伪造命令日志，"回放"就变成了"重演一段假历史"。

---

## 7. 执行语义

**C-17** **只有泵执行命令。** 插件不得在自身上下文里执行动作；技能 = 被动函数，返回意图而非副作用。
**C-18** 幂等：同一 `commandId` 重复执行**必须**是 no-op（重试/重放安全）。
**C-19** 超时（默认）：`walk` 60s、`dig` 30s、`place` 15s、`say` 10s、`look` 5s、`switch_scene` 5s、`play_media` 10s。超时**必须**产出 `cancelled` 记录，**严禁**静默继续。
**C-20** 相位切换**必须**取消所有在途命令，且取消本身是一条日志。
**C-21** 失败**不得**静默重试超过 1 次；重试必须可见。

---

## 8. 失败语义

| 情况 | 必须行为 |
|---|---|
| 参数校验失败 | `unsafe_arg` 拒绝 + 计数；不执行 |
| 能力缺失（插件未装/降级） | `no_capability` 拒绝；状态角标显示缺失能力 |
| 相位不允许 | `wrong_phase` 拒绝；她可说"等下播完这段" |
| 执行超时 | `cancelled` + 记录；世界状态以服务端为准，不试图回滚 |
| 执行中崩溃 | 泵重启后**必须**先对账（读世界状态），**严禁**盲目续跑 |

---

## 9. 可执行不变量

| 编号 | 不变量 | 验证方式 |
|---|---|---|
| I1 | 插件无法写命令日志 | 尝试写入必失败（broker 能力测试） |
| I2 | `ArgValue` 中不存在 Path/Url/裸 string | 类型测试（`expectTypeError`） |
| I3 | 同 `commandId` 两次 = 一次副作用 | 幂等集成测试 |
| I4 | 只有泵能执行（无其它入口） | 静态检查（仅 core 导出 execute） |
| I5 | `untrusted` 来源触发 L3 必被 deny | 属性测试 |
| I6 | 超时必产生 `cancelled` 记录 | 虚拟时钟测试 |
| I7 | 相位切换取消全部在途命令 | 集成测试 |
| I8 | 拒绝必落日志且计数 +1 | 单元测试 |
| I9 | 重放命令日志 → 结果序列一致 | 确定性测试 |
| I10 | 动词集变更必须带版本号 | CI 校验 `verbs.version` 变更需 ADR |

---

## 10. 待拍板（三处）

1. **`say` 的默认通道**：建议 `both`（配音 + 弹幕），但游戏内聊天有频率限制，需要单独配额。
2. **她能否自主下播**：建议可以，但只在 ENDING 相位、且带 30 秒倒计时与观众可见提示。
3. **观众点播直通还是转候选**：建议**一律转候选**——她决定放不放，这样"没放"也是内容的一部分，而不是系统失灵。

---

## 11. 接缝

- ← `SPEC-01`：闸门只吃 `UntrustedText`；`say` 是唯一出口。
- → `SPEC-03`：`wrong_phase` 的判定与取消语义由相位机提供。
- → `SPEC-04`：`switch_scene` / `idle` 的参数是场景 id，不是坐标或绘制指令。
- → `SPEC-06`：`L4` 热更走独立通道，不在本规格的动词表里。
