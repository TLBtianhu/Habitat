# Linux 轻量桌面 UI 库调研

> 2026-11-01 · 目标：Habitat Desktop 的任务栏、面板、HUD 是否有成熟轻量库可用。

## 候选

| 库 | 许可 | 适合什么 | 无头/集成判断 |
|---|---|---|---|
| **Nuklear** | 需复核（single-header C） | 极简面板、任务栏、按钮、状态卡 | **最适合软件渲染**：无 GPU 依赖，可自写 backend 输出 PNG/raw frame |
| **Dear ImGui** | MIT | 工具型 UI、复杂面板、调试台 | 成熟，但通常要 SDL/OpenGL backend；无头要渲染到 texture 再取帧 |
| **raylib + raygui** | Zlib | 游戏化界面、MC 叠加层 | 轻量好用，但无头显示/GL  backend 要额外处理 |
| **LVGL** | MIT | 嵌入式、Android、 framebuffer UI | 有 framebuffer 路线，适合未来移动端；桌面工具感弱于 ImGui |
| **Slint** | 需复核（可能 GPL/商业双许可） | 声明式原生 UI | 功能强，但许可和体积都要先评估，暂不作为默认 |

## 结论

- **桌面面板/任务栏首选 Nuklear**：小、无 GPU 依赖、容易做纯软件帧输出；
- **复杂工具面板选 Dear ImGui**：生态最成熟，但集成成本更高；
- **游戏化叠加层可考虑 raylib + raygui**；
- **Android/嵌入式优先 LVGL**；
- **Slint 先不动**，许可与分发形态要先查清。

## 集成方式

不要把 C/C++ UI 库直接塞进 AgentLoop 或 Node 主进程。正确形态是一个**原生 sidecar**：

```
desktopd
  → FramePlan(JSON)
  → desktop-ui sidecar（Nuklear / ImGui）
  → PNG / raw frames
  → Outlet（HLS / RTMP）
```

好处：

- 与 DSH/AgentLoop 完全隔离；
- 可单独重启、单独优化；
- 同一套 sidecar 可迁到 macOS / Android；
- 现在的 SVG renderer 可保留为轻量 fallback，不必立刻替换。

## 最终决定（2026-11-01）

**不采用 Nuklear / ImGui 作为运行时依赖，Habitat Desktop 自研渲染。**

原因：

- Habitat 的核心是 AppSession → FramePlan，不是控件库；
- 自研 SVG/Canvas backend 与状态模型天然一致，不需要把别人的 GUI 模型套进来；
- 避免额外的 native 依赖、许可与集成维护成本；
- Nuklear 仅作为“WSL 无头原生 UI 可行性”的一次验证保留，不进入产品路径。
