# 无头显示器：客户端拥有状态，显示器只做合成

> 2026-10-31 · 用户模型：每个客户端维护自己的状态并向像素投影；显示器只叠加各客户端的 UI；live 客户端再把合成帧推到第三方平台。
> 本文把它落成接口，并划清**状态所有权 / 光栅化 / 视角控制**三件事。

---

## 1. 三个概念，别再混

| 概念 | 谁负责 | 关键约束 |
|---|---|---|
| **状态**（世界、代码、聊天） | **各客户端自己**（mc / ide / live / browser） | 显示器**不持有**任何客户端的状态 |
| **投影**（把状态变成画面） | 客户端声明 `SceneDescriptor`，**显示器的渲染器执行** | 不是客户端往显示器里塞代码 |
| **视角**（看谁、全屏谁、相机在哪） | **视角事件（ViewEvent）**，由 Director 发 | 与"移动事件"是两条不同的通道 |

**显示器是一个合成器（compositor），不是数据模型。**

---

## 2. 客户端接口：SceneDescriptor

每个客户端只交付三样东西：状态快照、视角、布局提示。

```ts
type SceneDescriptor = {
  client: 'mc' | 'ide' | 'live' | 'browser' | 'standby';
  snapshot: unknown;          // 客户端自己的状态（世界快照 / 代码状态 / 聊天状态）
  view?: {                    // 这个客户端的"镜头"
    kind: 'firstPerson' | 'topDown' | 'editor' | 'chat';
    pos?: [number, number, number];
    yaw?: number; pitch?: number;
  };
  layout?: {                  // 只是提示，不是绘制命令（SPEC-04 S-4）
    space: 'full' | 'left' | 'right' | 'pip' | 'hidden';
    z?: number;
    opacity?: number;
  };
};
```

**显示器只认 `SceneDescriptor`，不认 MC 区块、不认实体表、不认代码 AST。**
客户端的状态永远留在客户端；显示器拿到的是"要画什么的声明"。

---

## 3. 无头显示器的职责

```
for each client:
    surface = renderer[client.kind].render(descriptor)
composite(surfaces, by layoutHint + ViewEvent)
output: 1280×720 @ 30fps 的帧
```

它**只做**：

1. 维护一个 **surface 列表**（`{client, view, layout, pixels}`）；
2. 按 Director 的视角事件切换全屏/画中画/隐藏；
3. 调各客户端的渲染器（在宿主 GPU 上）出帧；
4. 把合成帧交给 Outlet。

它**不做**：存世界、存聊天、存代码、执行客户端插件、决定"她该干什么"。

---

## 4. 视角事件：与移动事件分开

大肥鱼的输出有两类：

```ts
type MoveEvent  = { kind: 'walk'|'dig'|'place'|'say'|'idle', ... }   // 动作
type ViewEvent  = { kind: 'focus'|'camera', client?: string,
                    space?: 'full'|'pip'|'left'|'right'|'hidden',
                    camera?: { pos, yaw, pitch }, transition?: string }
```

- **移动事件**改变的是"她在世界里干什么"；
- **视角事件**改变的是"观众此刻看什么"。

`PLAY` 与 `CODE` 切换，本质就是一条 `ViewEvent{space:'full', client:'ide'}`。

---

## 5. 各客户端如何落地

| 客户端 | 状态在哪 | 投影怎么做 | 备注 |
|---|---|---|---|
| **mc** | WSL（bot + 世界镜像） | 宿主 `Camera Client`（RCON `/tp` 贴眼）出第一视角 | 状态不搬家，只发 `SceneDescriptor` |
| **ide** | WSL（源码/diff/测试） | 宿主 Monaco + xterm 重渲染 | 不是录 IDE，是重绘事件 |
| **live** | 平台弹幕流 | 聊天面板 + **发布能力**：把显示器帧推到平台 | 既是客户端，也是 Outlet 的平台适配器 |
| **browser** | WSL headless Chrome | 直接给帧（软件渲染够用） | 它是唯一"看着像录屏"的 |
| **standby** | 无 | 本地待机卡 | 播放头永不撒谎 |

**关键：mc 的"第一视角"不是显示器去维护世界，而是 mc 客户端给显示器一个"眼睛的位置"，由宿主 Camera Client 去渲染。**

---

## 6. 与"平台限制"的关系

B 站/抖音只接受 **RTMP 帧视频**，所以：

- **状态 → 视频**：由无头显示器统一负责（Presenter）；
- **视频 → 平台**：由 live/Outlet 负责（推流）。

如果哪天自己做直播软件，可以让观众**在直播界面里自己控制摄像机**——那是**另一套出口**（交互式场景图），它需要的是 `SceneDescriptor` 流，而不是帧流。**客户端不变，只换 Outlet。**

---

## 7. 信任边界（必须保留）

- 客户端在 WSL，**不可信代码不许在宿主执行**；
- 所以显示器只接受 `SceneDescriptor` + 快照/帧，**不接受客户端发来的可执行渲染逻辑**；
- 渲染器是宿主**受控的少数几个后端**（`firstPerson/topDown/editor/chat/standby`），不是"任意插件都能画"。

这条让"插件化"不变成"宿主执行任意插件"。

---

## 8. 与现有组件的对应

| 现有组件 | 在新模型里 |
|---|---|
| `bot/run.js`（WSL） | mc 客户端：状态 + `SceneDescriptor` 生产者 |
| `bot-host/camera.js` | mc 的呈现代理：按 view 渲染第一视角 |
| `stage/world.js` | `topDown` 渲染后端 |
| `stage/avatar-*.js` | 形象层（也属于 Presenter，不是客户端） |
| `pipeline.mjs` | Outlet：把合成帧编码推流 |
| `provider.worlds.mjs` | 世界会话，决定 mc 客户端连哪个 World Service |
| `live`（尚未实现） | 直播客户端：聊天输入 + 把显示器推给平台 |

---

## 9. 一句话

> **客户端负责"我现在是什么状态"，显示器负责"把这些状态摆到同一块屏幕上"，Director 负责"现在看哪一块"。**
> 世界不被搬来搬去，被搬的只是视角与投影。
