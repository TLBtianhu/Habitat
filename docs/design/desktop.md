# Habitat Desktop：面向 AI 应用的桌面系统

> 2026-10-31 · 不是“虚拟显示器”，而是 **桌面 + 合成器 + 呈现协议**。

## 1. 命名

- 对外：**Habitat Desktop**
- 守护进程：`desktopd`
- 协议对象：`SceneDescriptor / ViewEvent / AppEvent`

它管的不是像素窗口，而是**应用、焦点、任务栏、画面合成与输出**。

## 2. 它到底负责什么

```
客户端 AppSession ─┐
客户端 SceneDescriptor ─┼─► desktopd ─► 合成帧 ─► Outlet（HLS/RTMP/QQ 屏幕共享）
Director ViewEvent ────┘
```

职责只有四个：

1. **应用态**：open / background / focused / closed；
2. **表面态**：每个应用的 `SceneDescriptor` 与布局提示；
3. **合成**：把应用画面、形象、字幕、任务栏合成一帧；
4. **输出**：交给 Outlet，不直接决定她做什么。

**不持有 QQ 聊天记录、MC 区块、代码 AST，也不执行客户端插件。**

## 3. 内部模型

```ts
type AppSession = {
  appId: string;
  state: 'closed'|'open'|'background'|'focused';
  lastEventAt: number;
};

type Surface = {
  appId: string;
  descriptor: SceneDescriptor;
  layout: { space:'full'|'left'|'right'|'pip'|'hidden', z:number, opacity:number };
  dirty: boolean;
  lastFrameAt: number;
};
```

**AppSession 与 Surface 分开**：一个管“应用在不在”，一个管“它此刻长什么样”。

## 4. 合成层

固定六层，不允许客户端自由绘制：

1. 背景/底图；
2. 当前主应用 surface；
3. 其他应用的 PiP surface（可选）；
4. 形象 overlay（Live2D/clips，可选）；
5. 字幕与 HUD；
6. **任务栏**（由 AppSession 生成，不由客户端提供）。

任务栏是桌面自己生成的：

```
[ MC · focused ] [ QQ · background ] [ IDE · closed ]
```

## 5. 渲染后端

**MC 主画面必须用现成的渲染器，不由 Desktop 重实现。**

| 后端 | 输入 | 输出 |
|---|---|---|
| `mc.firstPerson` | **现成 MC 渲染器的帧源**（prismarine-viewer 或原版 Java 客户端） | 第一视角帧 |
| `mc.topDown` | 稀疏高度图 | 仅用于观测/调试，不作主画面 |
| `ide.monaco` | 代码事件/diff/测试 | 编辑器帧 |
| `qq.chat` | QQ 消息事件 | 聊天面板 |
| `browser.frame` | headless 页面帧 | 网页画面 |
| `avatar.overlay` | AvatarState + RMS | 形象层 |
| `standby` | 无 | 待机卡 |

**原则：Desktop 只嵌入现成渲染结果，不重写 Minecraft 渲染器。**
如果未来要最接近原版画面，可以接一个受控的原版 Java 客户端帧源；当前先用已有的 prismarine-viewer 作为第一视角后端。

## 6. 性能原则

- 只重绘 `dirty` 的 surface；
- 每个 surface 独立限帧（MC 20–30fps，QQ/IDE 5–10fps，任务栏 1–2fps）；
- 合成帧恒定 30fps，没新内容就复用上一合成帧，但不冻结“播放头状态”；
- 重 3D 只出现在需要的地方，避免全量世界渲染；
- Outlet 独立于后端，后端崩了只影响对应 surface。

## 7. 与现有实现的迁移

当前 `display/server.mjs` 只是 surface 注册表，下一步演化成 `desktopd`：

```
display/server.mjs
  → desktop/app-registry.mjs    # AppSession
  → desktop/compositor.mjs      # 六层合成
  → desktop/backends/*          # 受控渲染后端
  → desktop/outlet.mjs          # HLS/RTMP/共享
```

现有 `stage/` 可以先作为一个 `stage` 后端接入，**不必一次重写所有渲染**。

## 8. 一句话

> **Habitat Desktop 是 AI 应用的桌面：它管“哪些应用开着、谁在前台、观众看到哪一块”，而不是替任何客户端保存状态。**
