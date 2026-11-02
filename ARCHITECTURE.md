# Fishbowl 系统架构 v3：AI 客户端模型

> 2026-10-31 · 取代 v2 的"Authority / Worker / Renderer / Outlet"命名。
> **行为不变；角色、通道与命名统一。**
> 核心：**大肥鱼不是 AI 主播，而是一个 AI 特化客户端。直播只是客户端的一个出口。**

---

## 1. 一张图

```
                         平台事件（弹幕/礼物/关注）
                                   │
                                   ▼
┌────────────────────────────── Director（认知中枢）──────────────────────────────┐
│ 节目单 · 模式机 · 意图闸门 · 技能注册表 · 记忆/承诺 · 凭证 · 命令日志 · 观测编译器 │
└───────────────┬───────────────────────────▲───────────────────┬──────────────┘
       intent / policy                    │ obs / state          │ director（场景/字幕/状态位）
                ▼                         │                     ▼
        ┌───────────────┐         ┌───────┴────────┐      ┌─────────────┐
        │  AI Client    │ ───────►│   Presenter    │ ───► │   Outlet    │
        │  AI 特化客户端 │  状态   │  投影/呈现      │  帧   │ 编码/推流/录制│
        │ bot·browser   │         │ 舞台+形象+相机   │      │ ffmpeg      │
        └───────┬───────┘         └────────────────┘      └─────────────┘
                │ MC 协议 / CDP / PTY            ▲
                ▼                                │
        ┌──────────────────┐                     │
        │  World Service   │                     │
        │  世界服务端（外部）│                     │
        └──────────────────┘                     │
                ▲                                │
        ┌───────┴────────┐                       │
        │ Camera Client  │ ── viewer :3007 ───────┘
        │ 相机（人类风格） │
        └────────────────┘
```

**世界只有一个真源，它有两个客户端：有脑子的（AI Client），和只有眼睛的（Camera Client）。**

---

## 2. 四个角色

| 角色 | 定义 | 不拥有什么 |
|---|---|---|
| **Director（认知中枢）** | 一切"事实"在这里被裁决：她是谁、答应过谁、现在第几代、能不能做某事、该不该切模式 | 不渲染、不执行不可信代码 |
| **AI Client（AI 特化客户端）** | 一切"不可信动作"在这里发生：逛网页、玩 MC、写代码、跑插件 | 不持有真源、不做最终画面 |
| **Presenter（投影/呈现）** | 把状态投影成帧与声音：场景、形象、字幕、第一视角 | 不裁决、不存档 |
| **Outlet（出口）** | 编码、推流、录制、断流重连 | 不参与内容决策 |

**World Service（游戏服务端）不属于其中任何一个角色**：它是外部服务、世界的真源。AI Client 与 Camera Client 都只是它的客户端。

---

## 2.5 两块，而不是四套系统

整个项目其实只有两块：

### A. AI 化的客户端（交互形式特化）

把"人用的客户端"换成"AI 用的客户端"，每一种都是一个**可热插拔的适配器**：

| 适配器 | 什么时候在 | 提供什么 |
|---|---|---|
| `mc-launcher`（启动器，类 PCL） | 常驻 | 世界注册表、版本/模组下载、实例与登录、预检（注册表 Windows；下载/构建 WSL） |
| `mc`（Minecraft 客户端） | `worldId` 非空时 | 连接、obs、动作、**游戏内聊天** |
| `live`（直播客户端） | `streaming=true` 时 | 读弹幕、发弹幕、礼物/SC、关注 |
| `ide`（AI 版 IDE） | CODE 相位 | **只写 MC 模组**：委托 coding agent → 编译/测试 → 上线（编排 Windows；构建 WSL） |
| `browser`（网页客户端） | 需要上网时 | CDP 观察与输入 |
| `terminal`（终端客户端） | CODE 相位 | PTY、文件、测试输出 |

**两个维度不能混**：IDE 客户端只产"模组"，AgentLoop 自迭代才产"行为插件"。详见 [design/client-taxonomy.md](design/client-taxonomy.md)。

**关键语义：**
- `streaming=false` → `live` 适配器**从工具注册表卸载**——不是"禁用"，是**不存在**。她连"直播间评论"这个工具都看不到。
- `worldId=none` → `mc` 适配器同样卸载；但她的记忆、技能、人格不动。
- **游戏内聊天是 `mc` 适配器的通道，直播弹幕是 `live` 适配器的通道**——两个不同的客户端，别混。
- 热插拔形式可以是 MCP 工具注入，但**注册/卸载由模式与世界会话驱动**，不是常驻。

### B. 心智泵（AgentLoop）

Director 里真正"像她"的部分：**感知 → 思考 → 动作** 的循环，加记忆、承诺、节目单、技能注册表。

**必须与我们日常用的 DSH 解耦**：

- DSH 的默认工具面（`pwsh`、文件系统、computer-use、任意子代理）**不能暴露给她**。一旦暴露，WSL 沙箱就只是装饰——她可以直接在宿主上跑命令。
- 所以 Director 是一个**独立的窄 AgentLoop**：只持有闭集动词、观测帧、节目单、技能注册表。
- DSH 可以作 **provider**（LLM 接入、技能加载、子代理编排），但不是运行时必需。项目不应要求使用者装 DSH。

```
AgentLoop（独立、窄）── provider ──► DSH（可选：模型/技能/子代理）
        └── 永不继承 DSH 的 pwsh / fs / computer-use
```

---

## 2.6 放置：哪些在 Windows，哪些在 WSL

| 组件 | 位置 | 为什么 |
|---|---|---|
| **Director / AgentLoop**（观测、闸门、模式机、记忆、承诺、凭证） | **Windows** | 需要密钥与真源；但**工具面必须窄** |
| **AI Client**（browser、bot、代码执行） | **WSL** | 不可信执行，必须隔离 |
| **Camera Client**（相机 + viewer） | **Windows** | 需要 GPU 渲染 |
| **Presenter**（stage、形象、字幕） | **Windows** | 呈现与出口同域 |
| **Live 适配器**（B站/抖音弹幕） | **Windows，热插拔** | 平台 API；只读/受限写；随 `streaming` 装卸 |
| **World Service**（MC 服务端） | **Windows 或外部** | 本地可选；也可在朋友的服/公开服 |
| **Bridge**（I/O 总线） | **Windows 回环** | 唯一跨界通道，只绑 127.0.0.1 |
| **Outlet**（pipeline + ffmpeg） | **Windows** | 编码、推流、录制 |
| **凭证**（API key、TTS key、平台 cookie） | **只在 Windows** | 沙箱内 `grep -r "sk-"` 必须为空（SPEC-06 K-7） |

**心智在 Windows，身体在 WSL，世界与眼睛在 Windows 或外部。**
之所以不把 AgentLoop 也塞进 WSL：它会需要 API key；而 key 不允许进沙箱。于是正确解法是**窄工具面的 AgentLoop 留在宿主**，而不是把整个 DSH 搬过去。

---

## 2.7 目标形态：厚沙箱，薄宿主

"危险的去 WSL"会造出等级差（宿主是特权大脑，沙箱是二等公民）。正确目标是：

```
┌──────────── 不可信域（沙箱）────────────┐
│ AgentLoop（窄） + AI Client + 技能运行时  │── 出站：状态/帧 ──┐
└──────────────────────────────────────────┘                  ▼
                                   薄宿主（可信壳）：凭据代理 · Presenter · Outlet
```

- **AgentLoop 也进沙箱**；API key 由宿主**凭据代理**代持，沙箱只收结果，不存 key；
- 宿主只剩三个可审计的小服务：**凭据代理、呈现、出口**；
- 心智与身体同域，**没有特权方**；宿主攻击面最小。

> WSL 不是"危险品收容所"，是这个 AI 系统的家；Windows 只是门卫。

---

## 2.8 身份中心（Identity Hub）

客户端可以插件化，但账号必须统一。新增客户端只交一份 `identity.manifest.json`（登录方式、字段、scope、secretRef），**绑定界面由中心自动生成**，不改 UI 代码。原始凭证只在 Identity Hub；客户端只拿 `identityId + 按 scope 签发的短期 token`。详见 [design/identity-hub.md](design/identity-hub.md)。

---

## 2.9 原生 Display Server 与 QQ 客户端

**Display Server 与 DSH 同级**：DSH 是心智运行时，Display Server 是呈现运行时。它只接收 `SceneDescriptor` 与 `ViewEvent`，输出合成帧给 Outlet（RTMP/HLS/QQ 屏幕共享），不持有客户端状态。QQ 客户端走**独立协议后端**（go-cqhttp / Lagrange.Core / NapCat + OneBot），不注入、不开 QQ 窗口。详见 [design/display-server.md](design/display-server.md)。

---

## 2.10 Windows 只是引导器

最终形态：**Windows 只有安装包 EXE、启动/关闭 EXE、身份绑定辅助三个入口**；AgentLoop、客户端、Display Server、Outlet、技能/知识库/配置/缓存、Identity Hub 全部在 WSL。当前的 `bridge.mjs`、`pipeline.mjs`、宿主相机与 `C:\ProgramData\Habitat` 都是过渡形态，必须迁入 WSL。详见 [design/windows-thin-bootstrap.md](design/windows-thin-bootstrap.md)。

---

## 3. AI 客户端的五个通道

这就是"AI 特化"的全部含义——人类客户端的通道换形态，游戏与协议不变。

| 通道 | 人类客户端 | AI Client |
|---|---|---|
| **连接** | MC 协议 / 浏览器 / 终端 | 同一套协议（mineflayer、CDP、PTY），**不换** |
| **感知** | 渲染成像素给眼睛 | **稀疏声明**（obs 快照）+ 按需低清图 |
| **动作** | 鼠标键盘、连招 | **闭集动词 + 参数 + 代码**（命令） |
| **会话** | 点开聊天框打字 | 结构化事件 + `say()`，无需输入框 |
| **记忆** | 玩家自己的脑子 | 持久记忆 + 承诺账本 + 场次交接 |
| **扩展** | mod / 资源包 | **沙箱插件 + 技能库**（可回滚） |

**游戏一行不改，服务端一行不改。** 变的是"谁在用、怎么用"。

---

## 4. 六条不变量

1. **Director 与 AI Client 不同域**：客户端崩了不带走世界与记忆；客户端也不能直接改真源。
2. **AI Client → Presenter 只单向出站**：状态出去，画面不回来；反向只有窄策略通道。
3. **Presenter 不持真源**：只持快照，丢了能重建。
4. **Outlet 独立于 AI Client**：客户端崩了，直播不断（切待机卡）。
5. **播放头永不撒谎**：宁可黑场/待机，不定格旧帧。
6. **勤快只在出口**：AI Client 只出状态/事件，帧只在 Presenter 与 Outlet 产。

---

## 5. 五条链路

| # | 链路 | 方向 | 频率 | 内容 | 失败语义 |
|---|---|---|---|---|---|
| **state** | AI Client → 桥 → Presenter | 10–30 Hz / 0.5–1 Hz | 屏幕帧、obs、world、代码事件、心跳 | 断=她掉线；桥缓存最后帧并计龄 |
| **policy** | Director/桥 → AI Client | 按需 | navigate、click、key、start/stop screencast | 超时不重试 |
| **director** | Director → Presenter | 事件 | 切场景、字幕、表情、相位、状态位 | Presenter 保持上一场景并标"陈旧" |
| **command** | Director → AI Client | 低频 | walk/dig/say/switch_scene… | 超时→cancelled，落命令日志 |
| **publish** | Presenter → 平台 | 30 fps | H.264/AAC | 断流重连 + 本地录制 |

**全系统只有一条跨界通道**：从 AI Client 发起的 TCP（`bridge.mjs` ↔ `body.py`，NDJSON）。state 与 policy 复用它。

---

## 6. 三个客户端，同一台服务器

| 客户端 | 职责 | 位置 |
|---|---|---|
| **AI Client（她）** | 读 obs、出命令、说话、写插件 | WSL（mineflayer bot / headless browser） |
| **Camera Client（相机）** | 只负责"被看见"：第一视角渲染 | 宿主相机 bot + prismarine-viewer |
| **Human Client（你）** | 正常游玩 | 你的正版客户端 |

三者平级。相机不是"她的眼睛"，是**观众的眼睛绑在她的坐标上**。

---

## 7. 渲染链与版本矩阵

### 7.1 渲染链

```
宿主 ── MC 服务端（World Service）
        │                        │
        │ 协议                    │ 协议
        ▼                        ▼
  AI Client（WSL）          Camera Client（宿主）
  有脑子：技能/决策/obs      没脑子：只负责"看见"
        │                        │
        │ obs / world            │ prismarine-viewer :3007
        ▼                        ▼
  桥 :9224/:9225            Presenter（stage iframe / canvas）
        └──────────► Outlet（pipeline）→ mp4 / RTMP
```

### 7.2 版本矩阵

| 层 | 版本 | 约束 |
|---|---|---|
| 世界服务端 | **MC 1.21.4** | 渲染器支持上限 |
| AI Client | mineflayer **4.39** | 协议 |
| Camera Client | mineflayer 4.39 + prismarine-viewer **1.33** | 渲染 |
| 渲染器支持 | 1.8.8 … **1.21.4** | 硬上限 |
| 模组（后续） | NeoForge **21.1.x** | 与世界同版本 |

**规则：世界版本 = 渲染器支持上限 = bot 支持版本 = 模组工具链版本。**
渲染器必须认识世界版本；相机必须是服务端承认的玩家（RCON `/tp` 跟拍，不靠客户端瞬移）。

### 7.3 无头显示器模型（2026-10-31 定稿）

**客户端拥有状态，显示器只做合成。** 详见 [design/headless-display.md](design/headless-display.md)。

```ts
type SceneDescriptor = {
  client: 'mc'|'ide'|'live'|'browser'|'standby',
  snapshot: unknown,                       // 客户端自己的状态（世界/代码/聊天）
  view?: { kind:'firstPerson'|'topDown'|'editor'|'chat', pos?, yaw?, pitch? },
  layout?: { space:'full'|'left'|'right'|'pip'|'hidden', z?, opacity? }  // 提示非命令
}
```

- 显示器只维护 **surface 列表**，不维护 MC 区块、代码 AST、聊天历史；
- 客户端只交 `SceneDescriptor`，**不交可执行渲染逻辑**（信任边界）；
- 渲染由宿主少数受控后端执行：`firstPerson / topDown / editor / chat / standby`；
- **移动事件与视角事件分离**：`MoveEvent` 管她在世界里干什么，`ViewEvent` 管观众看什么；
- `PLAY ↔ CODE` 的切换就是一条 `ViewEvent{space:'full', client:'ide'}`；
- B站/抖音只要帧视频，所以 **状态→视频（显示器）与 视频→平台（live/Outlet）是两条独立边**；
- 若将来做交互式直播软件（观众自控摄像机），那只是**换一个 Outlet**，客户端不动。

---

## 8. 三条轴：认知 / 世界 / 播出

| 轴 | 取值 | 谁拥有 |
|---|---|---|
| 认知（身份/记忆/承诺/技能） | 常驻 | Director |
| 世界（她在哪个服/房间） | `worldId` / `none` | World Service（外部服务） |
| 播出（观众能否看见） | `streaming` | Outlet |

```
worlds.json
   └─ provider.worlds.mjs connect <id>
        └─ artifacts/world-session.json
             ├─► AI Client 读会话（换世界=重连）
             └─► Camera Client 读会话
```

- **换世界 = 换槽**，她的 id、记忆、承诺、桥、流水线都不动（SPEC-05）。
- `worldId = none` = 纯聊天/写代码；`streaming = false` = 高级群聊机器人。
- 本地服由 `local-world.mjs` 独立管理；**AI Client 的启动脚本不启动任何服务端**。

---

## 9. 模式机与生命周期

七相位（SPEC-03）：`BOOT → OFFLINE ⇄ IDLE ⇄ PLAY ⇄ CODE → VERIFY → ENDING`，任意相位可落 `DEGRADED`。

- **PLAY 与 CODE 永不共存**：改的时候不跑，跑的时候不改。既是安全边界，也是算力边界。
- 模式机住 Director，同时驱动 Presenter（切场景）与 AI Client（quiesce/恢复）。
- 下播必须是谓词（ADR-003）：承诺清空、时长达标、不是因为卡住；`ENDING → OFFLINE` 前必须写 `session.json`。

---

## 10. 失败域与自愈

| 故障 | 感知 | 恢复 | 直播表现 |
|---|---|---|---|
| Chrome 崩 | AI Client（waitpid） | 本地重启 + 重挂页面 | 桥缓冲，Presenter 切"信号中断" |
| 页面卡死 | AI Client（心跳缺失） | 杀 Chrome → 同上 | 同上 |
| AI Client 死 | systemd | `Restart=always` | 同上 |
| 桥死 | 监工（WaitForExit） | 重启，Client 自动重连 | 同上 |
| 世界服务端崩 | systemd / Director | 重启，bot 重连对账 | 世界场景切待机 |
| Presenter 死 | Outlet 探帧 | 重启 Presenter | Outlet 播本地待机卡 |
| Director 死 | 看门狗 | 重启，读 `session.json` 恢复 | Presenter 保持最后场景 |
| 跨界断链 | 双方 | 指数退避重连 | 桥保留最后帧 + 计龄 |

---

## 11. 放置矩阵（位置可变，角色不变）

| 角色 | v1（现在） | v2（可选） |
|---|---|---|
| Director | 宿主 Node | 宿主 / 云 |
| World Service | **WSL 原生 JDK**（`~/fishbowl/world-server`，已从宿主迁入） | 独立容器 / 朋友的服 / 公开服 |
| AI Client | WSL | Docker / VM / 另一台机 |
| Camera Client | 宿主 | GPU 机器 / 云渲染 |
| Presenter | 宿主 Chrome + `stage/` | 同左或远程 |
| Outlet | 宿主 `pipeline.mjs` + ffmpeg | 宿主 / 转推服务器 |

**验收测试**：把 AI Client 从 WSL 换成 Docker，Presenter/Outlet/Director 一行不改，只换 provider 配置。

---

## 12. 当前实现状态

| 组件 | 角色 | 状态 |
|---|---|---|
| `fishbowl-body.service` | AI Client | Chrome(pipe CDP) + 出站链路 + 心跳 + sd_notify ✅ |
| `fishbowl-world.service` | AI Client | 读世界会话、bot + obs/world 出站 ✅ |
| `~/fishbowl/world-server`（WSL） | World Service | **WSL 原生 JDK 25**，不依赖宿主 JDK ✅ |
| `bot-host/camera.js` | Camera Client | RCON `/tp` 跟拍 + viewer :3007 ✅ |
| `bridge.mjs` | I/O 总线 | 多角色链路、帧缓存、`/nav /eval /click /obs /world`、caps 校验 ✅ |
| `stage/` | Presenter | 六层舞台 + sprite/live2d/clips 三个形象后端 ✅ |
| `pipeline.mjs` | Outlet | 恒速 30fps、待机卡、Chrome 自愈、RTMP 可切 ✅ |
| `provider.mjs` | 放置层 | 唯一知道 Worker 在哪（WSL）✅ |
| `provider.worlds.mjs` | 世界启动器 | `list/connect/leave/status` ✅ |

**违约台账**：V1（世界与 Worker 同域）、V2（WSL 泄漏）、V3（播出无看护）均已修复。

---

## 13. 与规格的映射

| 边/角色 | 规格 |
|---|---|
| 平台事件 → Director | SPEC-01 事件模型 |
| Director → 动作 | SPEC-02 命令与意图闸门 |
| 模式与恢复 | SPEC-03 相位机 |
| Presenter | SPEC-04 场景协议 |
| 身份/槽/代数 | SPEC-05 |
| AI Client 能力与热更 | SPEC-06 + RUNTIME |
| 观测 | SPEC-07 观测编译器 |
| 素材许可 | ADR-002 |
| 生命周期/下播 | ADR-003 |
| 渲染与客户端模型 | design/ai-client.md、design/world-render.md、research/mc-rendering.md |

---

## 14. 下一步（按依赖顺序）

1. **模式机实现**：把 SPEC-03 变成可运行的 Director 状态机（含 quiesce 与降级）。
2. **技能运行时**：artifact、broker、蓝绿、回滚、影子模式（P4）。
3. **CODE 场景**：Monaco + xterm 的事件重渲染，接插件热更。
4. **平台适配器**：B 站正式、抖音降级；`streaming` 开关接 Outlet。
5. **OBS/直播发布**：第一场上线前，先跑通本地 RTMP 与录制。

---

## 15. 一句话

> **Director 决定"她是谁"，AI Client 决定"她做什么"，Presenter 决定"观众看见什么"，Outlet 决定"发到哪"。**
> 游戏没变，变的只是"谁在用、怎么用"。
