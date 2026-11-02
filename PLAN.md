# 计划：从冻结规格到第一次开播

> 状态：v0.1（2026-10-31）
> 依据：[READING.md](C:\Habitat\READING.md) 十八条律 · [ARCHITECTURE.md](C:\Habitat\ARCHITECTURE.md) · [RUNTIME.md](C:\Habitat\RUNTIME.md)
> 纪律：**不可逆区先写规格，可逆区放手做；每阶段验收必须是 CI 可执行的不变量，不是截图。**

---

## 0. 三条前提（已经定死，不再讨论）

1. **播出不可中断**，但组件可以崩。她的世界可崩可重启，呈现与推流在边界外。
2. **播放头永不撒谎**：宁可黑场/待机，不得拿旧帧冒充实时。underflow 是主路径。
3. **她能改的只有可弃层**：舞台、编码、平台、沙箱管控不在她的加载路径上。最激进的自迭代层必须能整块删除。

---

## 1. 可逆性划分（决定谁先写规格）

| 不可逆区（先冻结，写 ADR） | 可逆区（直接做，随时换） |
|---|---|
| 项目命名、事件 schema、命令动词集 | 场景配色、动画曲线、字体、转场 |
| 相位不变量、id 语义、能力清单 | 技能实现、切镜策略、提示词 |
| 插件 ABI、artifact 格式、回滚语义 | TTS 参数、弹幕样式、快捷键 |
| 许可与资源边界、平台能力模型 | 目录布局、日志格式、测试写法 |

**判断标准**：改它会不会让已经发出去的 fork/录播/存档失效。会 → 不可逆。

---

## 2. 六个阶段

| 阶段 | 目标 | 周期（示意） | 退出条件（CI 可验） |
|---|---|---|---|
| **P0** | 规格冻结 | 3–4 天 | 6 份 SPEC + 2 份 ADR，每条不变量有对应测试或类型 |
| **P1** | 隔离地基 | 1 周 | 三条日志断言全绿，宿主零输入 |
| **P2** | 舞台与三场景 | 2 周 | 本地推流可看，端到端 < 1.5s，切场景无黑屏 |
| **P3** | MC 世界 | 2 周 | bot 完成 10 个原子任务，世界视图 30fps |
| **P4** | 自迭代闭环 | 2–3 周 | 坏技能不切换、异常自动回滚、30 代后 id 不变 |
| **P5** | 平台与发布 | 2 周 | B 站能播、抖音降级正确、陌生人 30 分钟跑起来 |

合计 10–12 周（单人 + AI 辅助）。时间只作排期用，**不当承诺**。

### P0 规格冻结（最不可逆，先把三把刀磨好）

产出 `docs/spec/`：

- `01-events.md`：统一事件模型（chat/gift/superchat/member/follow/like）+ 来源/权限/去重键/限速
- `02-commands.md`：命令动词集（第一版 ≤ 12）+ 参数 schema + 权限等级
- `03-phases.md`：相位机与不变量（PLAY/CODE/VERIFY/DEGRADED/ENDING 的转换协议）
- `04-scenes.md`：场景协议（present(state) 只给展示提示，禁止绘制命令）
- `05-identity.md`：id / 槽 / 代数（身份与地址分家、单调发号、无环）
- `06-capabilities.md`：能力清单与沙箱边界（能隔离/不能隔离的诚实清单）
- `ADR-001-name.md`：项目命名（不得以 Minecraft 开头）
- `ADR-002-license.md`：MIT + 资源不进库 + AGPL 适配器隔离 + 免责声明

**验收**：每条不变量要么是类型（编译不过），要么是测试（CI 红），要么是 lint 规则。**写不出可执行形式的，说明还没想清，不算冻结。**

### P1 隔离地基

> **2026-10-31 实测修正（两次）**
> ① 本机 WSL 无 sudo 密码、且未装 Xvfb/Chromium/xdotool → 放弃 `x11grab + xdotool`。
> ② 进一步发现 Chrome 支持 `--remote-debugging-pipe`：CDP 走 fd3/4，**连端口都不需要**。
> 最终形态：**身体（WSL，systemd）→ 出站 TCP → 宿主桥**。WSL 内零监听端口，无轮询。
> 代价：v1 的"身体"是一台只有浏览器的机器；`desktop` 场景推迟（要用真桌面再装 Xvfb）。

- 身体：headless Chrome + 管道 CDP + 20fps 帧推送 + 页面心跳 + `sd_notify`
- 宿主：`bridge.mjs`（127.0.0.1:9224 收链 / 9225 状态与帧）+ 监工（进程退出才重启）
- 自愈：Chrome 死→`waitpid`；页面卡→心跳 10s 缺失；身体死→systemd；桥死→监工；断链→指数退避
- 三条日志断言（替代目测）：
  1. 沙箱运行期间**宿主输入事件计数 = 0**、前台窗口未变；
  2. 服务命名空间内 `/mnt/c` 不可见（`InaccessiblePaths` 已实测为空）；
  3. 沙箱内点击 100 次，宿主光标坐标不变。
- 实测：帧 18fps / 11KB 每帧；杀 Chrome 7s 恢复；杀身体 8s 恢复（NRestarts=1）；杀桥自动重连。

### P2 舞台与三场景

**已完成（2026-10-31 第一刀）**
- `stage/index.html`：六层（背景/主画面/角色/字幕/弹幕/角标），1280×720
- 主画面从桥的 `/frame` 拉取（渲染循环即拉模型）；2.5s 无新帧 → **切"信号中断"卡，不定格**
- `tools/stage-server.mjs`（9230）+ `tools/render-stage.mjs`（宿主 Chrome headless → CDP screencast → ffmpeg → mp4）
- 实测：6s 渲染出 360 帧、编码 112 帧（18.7fps）、178KB mp4
- **形象层已接真**：`?avatar=live2d` 加载鲸鱼娘 Live2D（Cubism 4 + PIXI），参数驱动口型/眨眼/视线/呼吸；素材与 Cubism Core 均 gitignore

- Stage 页：背景 / 画面 / 角色 / 字幕 / 弹幕 / 状态角标 六层
- Scene DESKTOP：x11grab → 低延迟流 → `<video>`（**v1 降级为浏览器页面捕获**）
- Scene CODE：Monaco + xterm，**事件重渲染**（不是录 IDE）
- Scene WORLD：prismarine-viewer 接入（P3）
- 转场保底：切场景时先上转场卡，再等新场景首帧（对应"播放头不撒谎"）
- 本地 MediaMTX 收流 + VLC 验证；端到端时延 < 1.5s

### P3 MC 世界

**已完成（2026-10-31）**
- WSL 免 root Node 22 + `mineflayer@4.39` + `prismarine-viewer@1.33`（node_modules 946 MB）
- MC **26.1 原版服务端**（57.6 MB，BMCLAPI→宿主下载→拷进 WSL），离线模式
- `fishbowl-world.service`（systemd）：服务端 + bot + viewer，挂了自动重启
- bot 已进服：`[join] Dafeiyu`、`spawned at (-11.5, 116, 15.5)`，持续 `[pos]` 心跳

**卡点已解（2026-10-31 晚）**：放弃"沙箱里渲染"，改为**世界状态出站 + 出口渲染**。
- bot 每 1–5 s 推 `obs`（观测快照，~1.5 KB），每 2 s 推 `world`（33×33 高度图，17.5 KB）
- 宿主 `stage/?scene=world` 用 canvas 2D 画 2.5D 体素沙盘（她把僵尸/苦力怕都看清了：实测 `creeper 7.3m`）
- Worker 无 GPU、无 WebGL、无 socket.io；渲染器与舞台都在出口
- 实测：世界 17.5 KB / 2 s，观测 ~1.5 KB，舞台渲染 18–20 fps

**2026-10-31 深夜：世界服务端已搬到宿主**（顺带修 V1：Authority 离开 Worker 域）
- WSL 的她连宿主 `127.0.0.1:25565` 成功入服（服务端日志：`Dafeiyu joined the game`）
- 宿主相机 bot（`bot-host/camera.js`）+ prismarine-viewer `firstPerson` 起在 `:3007`，舞台 `?scene=fp` 用 iframe 内嵌
- **第一视角仍只出天空**：相机 bot 客户端瞬移不会让服务端补发区块 → 视野里没有几何。
  下一步：给 Camera 加 OP 用 `/tp` 跟拍；或改自绘 three.js 第一视角。

- 技能集（走/挖/放/看/说）待 WORLD 可渲染后再接
- L3 模组线（P4 用）：她改的是**服务端**模组，重启的是服务器（20–40s），不是她的身体

### P4 自迭代闭环（最激进，必须可删）

- artifact 内容寻址 + `live.json`（id→槽）
- Broker：能力过滤 + 配额 + 超时；插件不得伪造命令日志
- 蓝绿切换：预热 → 校验 → 排空 → 切指针 → 观察 60s → 回滚 < 1s
- 测试门禁：unit + 最近 20 条真实交互回放 + 一次性世界冒烟
- 影子模式：只算不做，对比线上结果
- **feature flag 一键整块禁用**（fork 者敢试的前提）

### P5 平台与发布

- B 站适配器：优先官方开放平台；弹幕 WS（blivedm 思路自研或依赖 MIT 库）
- 抖音适配器：**独立包、独立进程**（AGPL 或官方 API），能力协商 `push: none`
- 本地 MediaMTX → 单编码、多路 fan-out
- README（对外投影）+ 占位角色（CC0）+ `THIRD_PARTY.md` + `SECURITY.md` + 免责声明
- 许可证扫描进 CI：核心依赖里出现 GPL/AGPL 即失败

---

## 3. 三份 SPEC 的待拍板项（我先出草案，你改）

**SPEC-01 事件模型**
- 是否统一成 `{kind, source, user, text, value, at, dedupeKey, trust}` 七字段？
- 观众事件默认 `trust: untrusted`，只有"她自己的工具返回"是 `trusted`——这条要在类型上分家。
- 限速：每用户 3 条/10s，全局 60 条/10s，超出进"折叠队列"而不是丢弃。

**SPEC-02 命令动词集**（草案 11 个）
`walk` `dig` `place` `look` `say` `switch_scene` `play_media` `start_stream` `stop_stream` `idle` `handover`（人类接管）
——加一个动词 = 改核心，她不能改；她的表达力靠参数与组合，不靠添动词。

**SPEC-03 相位不变量**
- PLAY 与 CODE 永不同时"可操作"；
- 进入 CODE 前必须 quiesce（≤3s）+ 存档 + 挂机/登出；
- 任何相位失败只回退到上一相位，不回退到 IDLE；
- 人类接管（handover）是独立状态位，观众可见。

---

## 4. 仓库结构

```
fishbowl/
├─ docs/spec/            # 冻结件
├─ packages/core/        # 相位机、事件总线、命令注册表
├─ packages/stage/       # 舞台页
├─ packages/scenes/{desktop,code,world}
├─ packages/sandbox/     # Xvfb/Chromium/CDP/白名单 RPC
├─ packages/runtime/     # artifact、broker、蓝绿、回滚
├─ packages/platform/{bilibili,douyin,youtube}
├─ apps/director/        # 编排
├─ tests/isolation/      # 隔离日志断言
└─ assets/placeholder/   # CC0 占位角色；真角色不进库
```

## 5. 不做清单（防 Hurd 陷阱）

- 不做通用 IDE、不做通用 VM、不做多窗口桌面
- 不做 Fabric 模组热更（只用"重启窗口"）
- 不做真人级数字人（先帧动画）
- 不做多平台同时推（先单平台跑通）
- 不做云端部署（先单机）
- 不做观众投稿/社区功能（先自用）

## 6. 风险

| 风险 | 触发点 | 对策 |
|---|---|---|
| 上行带宽不足 | 1080p60 | 先 720p30 立档，NVENC |
| 4GB 显存暗串行 | 世界视图 + 编码 + 重渲染 | 脏重算；世界视图限 30fps；必要时降到 720p |
| B 站风控 | 开播/私信 | 小号；接口失败降级为"只播不互动" |
| 抖音无推流码 | 普通账号 | 能力协商，明说做不到 |
| 自迭代改坏 | 她写错测试 | 评估器外置 + 每代快照 + 一键禁用 |
| 笔记本睡眠 | 电源策略 | 从不睡眠 + 开机自启 + 看门狗 |

---

## 7. 节奏

- 每个阶段结束必须留下一份**可复跑的验收脚本**，否则不进入下一阶段；
- 每两周一次"过一遍规格"：被现实推翻的律当场改，不留并存（认知更新律）；
- 文档只维护两份：`docs/spec/`（真源）+ `README.md`（投影）。

### 2026-10-31 收尾状态

| 项 | 状态 |
|---|---|
| P1 隔离地基 | ✅ 身体在 WSL、无端口、心跳、自愈 |
| P2 舞台与三场景 | ✅ 舞台六层；形象后端 sprite/live2d/clips；`?scene=fp/world` |
| P3 MC 世界 | ✅ 世界在宿主 1.21.4；她与相机两个客户端；第一视角出画面；obs/world 出站 |
| P3.5 世界启动器 | ✅ `worlds.json` + `provider.worlds.mjs` + `local-world.mjs`；换世界=换槽（实测离服/入服期间桥不断） |
| V1 世界与 Worker 同域 | ✅ 已修（服务端搬到宿主） |
| V2 WSL 泄漏 | ✅ 已修（provider.mjs 唯一入口 + caps 校验，violations=[]） |
| V3 播出无看护 | ✅ 已修（pipeline.mjs：恒速 30fps、待机卡、Chrome 自愈、RTMP 可切） |
| P4 技能运行时 | ⬜ 未开始（相位机 + 蓝绿 + 回滚） |
| **M1 模式机** | ✅ `director/phase-machine.mjs` + 7 个测试全过（quiesce/降级恢复/下播谓词/接管/状态回滚） |
| **M2 技能运行时** | ✅ `runtime/skill-runtime.mjs` + `verify-m2.mjs`：能力拒绝、坏 artifact 不换、崩溃自动回滚、30 代不泄漏（终态 slots=1） |
| **M3 CODE 场景** | ✅ `stage/code.html`：Monaco + xterm 事件重渲染；真实 激活→编辑→崩溃→回滚 上屏（终态 gen 3 / rollback） |
| **M4 短验** | ✅ 隔离断言、回放一致、故障注入、1 分钟 soak 全过；2 小时长验运行中 |
| **M4 长验** | ✅ 2 小时：1438 ticks，errors=0，stalls=0，maxFrameAge=1475ms（tick 阈值误报已修） |
| **分发环境分离** | ✅ `tools/install.mjs` 安装到 `%ProgramData%\Habitat`；安装环境内 M2 与 AgentLoop 验收通过；`audit-paths.mjs` 标出 33 处硬编码开发路径待重构 |
| **WSL 运行时迁移** | ✅ bridge/body/world/世界服务端/世界会话全部进入 WSL 用户态；宿主不再运行桥进程 |
| **WSL Display/Outlet** | ✅ stage-server + pipeline + HLS 全部在 WSL；`http://127.0.0.1:9230/hls/live.m3u8` 可访问 |
| **WSL 第一视角** | ✅ `habitat-camera.service`：WSL 原生 prismarine-viewer + RCON 跟拍，第一视角出画面（非天空） |
| **薄入口收敛** | ✅ Windows 只保留启动器与安装/授权辅助；Identity Hub 也迁入 WSL；启动脚本不再拉起 Windows 运行时组件 |
| **LLM provider** | ✅ `agent/llm-provider.mjs`：OpenAI-compatible + mock；合法 intent、非 JSON、非白名单动词均正确处理；规则脑回归通过 |
| **真实 LLM 连通** | ✅ DeepSeek API 实测返回动作；参数名归一化（block/count→target/n）；密钥存 `/etc/habitat/llm.env`（600，不回显） |
| **统一授权页** | ✅ `stage/identity.html` + provider 插件：DeepSeek key 通过统一接口校验并写入 `/etc/habitat/llm.json`（600），身份记录不存明文 |
| **B 站扫码授权** | ✅ `identity/providers/bilibili.mjs`：QR generate/poll 实测通过，等待扫码状态正确返回 |
| **DSH MCP 插件** | ✅ `mcp/mc-server.mjs`：stdio JSON-RPC，`mc.obs/walk/dig/say` 三方法验收通过 |
| **Habitat Desktop** | ✅ 从零实现 AppRegistry/Projection/Compositor/SVG Renderer；主画面/PiP/任务栏均由 AppSession 投影生成 |
| **记忆与主动性** | ✅ `agent/memory.mjs`（工作记忆衰减 + 档案检索）与 `agent/initiative.mjs`（安静时主动小事+额度）接入 AgentLoop，回归全过 |
| **QQ/B站客户端** | ✅ `clients/onebot.mjs`（登录/群聊/私聊/事件）与 `clients/bilibili.mjs`（视频/直播间/弹幕边界），Mock API 验收通过 |
| **QQ 原生后端** | ✅ NapCat 已登录开发态账号，OneBot HTTP/WS 已启动；`get_login_info` 与 `sendPrivateMsg` 实测成功 |
| **原生 MC 客户端** | ✅ Fabric + Iris + Sodium 原版渲染已进入世界；`--quickPlayMultiplayer` 自动进服；mcpfabric 在 `25600` 可用；`player.getState`、`vision.describeScene`、`chat.send`、`control.lookAt` 已验证；Xvfb 像素自声明已接入 Desktop |
| **LLM 与连续像素流** | ✅ `agent/run-native-llm.mjs` 已让 DeepSeek 返回动作并驱动原生客户端；原生像素经 Desktop 接入 Outlet，HLS 帧已验证 |
| **分发与用户态** | ✅ `docs/ops/distribution.md` 明确安装包/运行时/用户数据三层；`tools/install-user.ps1` 已把包安装到全新 `/opt/habitat-user/app`，与开发态隔离 |
| **B 站登录** | ✅ 官方登录页扫码成功，SESSDATA 已写入 `/etc/habitat/bilibili.json`；`nav` 返回 `isLogin: true`（TLB天狐） |
| **控制面** | ✅ `control/server.mjs`：任务、批准、停运；无 token 不能批准；adapter 激活需主人 token |
| **Adapter 解耦** | ✅ `adapters/registry.mjs` + manifests（bilibili/qq/mc）+ `adapter-host` 按 PID 启停；B站 adapter 独立进程健康检查与弹幕验证通过 |
| **B 站弹幕** | ✅ WBI 签名 + `wss_port 2245` + `protover 3` + brotli；实测 12s 收到 15 条真实弹幕 |
| **WSL 原生化** | ✅ 本地 MC 服务端迁入 WSL 原生 JDK（Temurin 25），不再依赖宿主 JDK |
| **分发包** | ✅ `tools/wsl-provision.sh` + `tools/package.mjs` → `dist/fishbowl-v0.1.zip`（299 文件，33 MB）；**解包后 M2 与 AgentLoop 验收均通过** |
| **AgentLoop** | ✅ `agent/agent-loop.mjs`：窄 broker、相位感知、walk/dig/say 决策、限频；WSL 原生 Node 下 4 项验收通过 |
| **连续视频流接口** | ✅ `FB_HLS=1` 输出 HLS；本机可访问 `http://127.0.0.1:9230/hls/live.m3u8`（RTMP 仍可用 `FB_RTMP`） |
| **实玩动作** | ✅ AgentLoop → `/cmd` → MC bot：walk/dig/say 已真实执行（非仅观测） |
| **模组构建** | ✅ `tools/mod-build.sh` 强制 WSL 原生 JDK，不继承宿主 PATH；`tutorialmod-1.0.0.jar` 构建通过 |
| **一键总验收** | ✅ `tools/verify-all.mjs`：M2 + AgentLoop + M4 + 健康总览一次全过 |
| **Display Server MVP** | ✅ `display/server.mjs`：SceneDescriptor/ViewEvent/surface 管理，3 项验收通过 |
| **Identity Hub MVP** | ✅ `identity/hub.mjs` + `stage/identity.html`：manifest 自动注册、绑定/测试/注销、scope token，4 项验收通过 |

---

## 8. 需要你现在拍三件事

1. **项目名**：`Fishbowl` / `WhaleCast` / 你自己的；
2. **P0 的三份 SPEC 是否按上面的草案写**（尤其 11 个动词集）；
3. **P3 的"观众进服"进不进 v1**——进，P3 多一周；不进，v1.5。

拍完我就从 `SPEC-01` 开始写，写完一份给你审一份，不一次性铺开。
