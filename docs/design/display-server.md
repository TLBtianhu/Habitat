# 心智泵、原生客户端与原生显示屏

> 2026-11-01 补充：可选合成器、应用 Surface 与捕获会话的最新边界以 [compositor.md](compositor.md) 为准；本文中的 Display Server 不应与 Outlet 合并实现。

> 2026-10-31 · 原则：**DSH 是心智运行时，Display Server 是与它同级的呈现运行时。**
> 客户端只负责各自的协议与状态，不替显示屏工作，也不替 DSH 思考。

## 1. DSH 在这里负责什么

DSH（Linux 版）做心智泵：

- 模型接入与推理循环；
- 工具/MCP 注册与权限；
- 技能加载、子代理、会话与上下文压缩；
- 事件输入（QQ、MC、直播、定时器、系统事件）。

**不继承通用宿主能力**：不把 pwsh / 文件系统 / computer-use 直接暴露给她。她的动作只能走闭集客户端工具。

任务紧张时，**DSH 子代理负责并行**：研究、读文档、写模组、跑测试。世界可写动作仍由模式机串行裁决。

## 2. 每个客户端怎么实现

| 客户端 | 后端 | 关键点 |
|---|---|---|
| **qq** | **独立 QQ 协议客户端**：go-cqhttp / Lagrange.Core / NapCat（按可用性选），OneBot 作为上层协议 | **不注入、不开 QQ 窗口**。消息、群聊、私聊、戳一戳、图片都走协议/API |
| **bilibili** | 公开 Web API + 弹幕 WebSocket（blivedm / bilibili-api 类） | 刷视频、搜内容、看评论，不必开浏览器 |
| **mc-launcher** | 版本/模组/实例清单 + BMCLAPI / Modrinth / CurseForge 下载器 | 管实例与依赖，不管游戏内动作 |
| **mc** | mineflayer 协议 | obs、动作、游戏内聊天 |
| **live** | 平台弹幕/API + RTMP 推流 | `streaming` 控制装卸；推的是 Display Server 的合成帧 |
| **ide** | coding agent 编排 + WSL 原生构建 | 只写模组，不写她的心智 |
| **browser** | headless Chrome / CDP | 只在没有 API 时用 |

**QQ 的特别要求**：你说的"草台班子"问题在于注入现有客户端、抢窗口。新版必须是**独立进程、无窗口、协议级**。这样她上 QQ 时，你的电脑不会出现一个被操控的 QQ。

## 3. 原生 Display Server：与 DSH 同级的"显示屏"

它不是 DSH 的工具，而是**独立服务**，负责直播、QQ 屏幕共享、远程观看等呈现任务。

```
DSH（心智） ── ViewEvent ──► Display Server（呈现）
                                   ▲
                    SceneDescriptor │
                         QQ / MC / live / IDE / browser
                                   │
                                   ▼
                         Outlet（RTMP / HLS / QQ 屏幕共享）
```

### 职责

1. 接收各客户端的 `SceneDescriptor`（状态快照 + 视角 + 布局提示）；
2. 维护 surface 列表（z-order、全屏/画中画/隐藏、转场）；
3. 用受控后端渲染：`firstPerson / topDown / editor / chat / qq / browser / standby`；
4. 输出帧给 Outlet，或作为"虚拟屏幕"供 QQ 屏幕共享等客户端调用。

### 不做什么

- 不保存 QQ 聊天记录、MC 区块、代码 AST；
- 不执行客户端插件代码；
- 不决定"她该干什么"——那是 DSH/模式机的事。

## 4. 两条控制通道，别混

| 通道 | 内容 | 作用 |
|---|---|---|
| **MoveEvent** | walk/dig/say/qq.send | 她在世界里/群里的动作 |
| **ViewEvent** | focus/camera/layout/transition | 观众或共享对象看到哪块屏幕 |

`PLAY ↔ CODE` 是一条 ViewEvent；`QQ 屏幕共享` 是 Display Server 的另一种 Outlet。

## 5. 部署形态

```
Linux 服务器
  ├─ DSH（AgentLoop）
  ├─ MCP 客户端群（qq / mc / live / ide / browser）
  ├─ Display Server
  ├─ Outlet（HLS / RTMP）
  └─ Identity Hub
```

自己的 Windows 电脑只是其中一个部署环境；在服务器上，这套东西天然就是长驻服务。

## 7. Q 版 Live2D 的地位

**它是 Display Server 的可插拔 overlay 后端，不是 live 客户端的私有插件。**

- live 客户端负责平台聊天与推流，**不拥有形象**；
- 形象由 Director 提供 `AvatarState`（情绪、说话、动作、姿态），Display Server 负责挂载与合成；
- 任何呈现出口都可以选择是否挂载它：直播、QQ 屏幕共享、本地预览；
- **没有呈现需求时，它可以完全不存在**——她的人格与客户端仍在运行。

所以准确说法是：**它是 Display Server 的可选呈现层，通常随直播/共享场景一起被声明，而不是 live 客户端的一部分。**

## 8. 一句话

> **DSH 负责"她想什么"，客户端负责"她能做什么"，Display Server 负责"别人看见什么"。**
> 三者平级，谁也不吞并谁。

