# 原生 MC 客户端渲染与 MCP：参考项目与落地路线

> 2026-11-01 · 目标：**原生 Java 客户端 + 可开光影 + 自声明像素**，不是 prismarine-viewer 的近似渲染。

## 最值得参考的项目

### `denfry/mcpfabric`

- 原生 Fabric / NeoForge mod，支持 1.21.1–1.21.11、26.1–26.3；
- 在 Minecraft 内嵌本地 HTTP bridge，再由 TypeScript MCP server 暴露 50+ 工具；
- 支持移动、视角、导航、挖掘、建造、战斗、背包、截图与事件；
- 默认 loopback + bearer auth + capability gate；
- MIT。

**这就是“原版客户端只改交互”的现成范式。**

### `zoyluoblue/mc_aiplayer`

- 服务端生成真实玩家，DeepSeek/OpenAI 做目标规划，确定性任务执行；
- 63 工具、34 个 Task 状态机，适合借鉴“LLM 提意图，任务机执行”的分层；
- 但它不负责原版客户端的第一视角渲染。

## 我们的路线

```
原版 MC 客户端（Fabric/NeoForge）
  ├─ mcpfabric 或自研小 mod：观测、动作、事件
  ├─ Iris：光影（可选）
  └─ 帧捕获：把渲染结果声明给 Desktop
```

关键点：

- **不重写渲染器**：保留原版游戏与光影；
- **只改交互**：AgentLoop 通过 MCP/HTTP 发闭集动作；
- **像素自声明**：客户端把渲染帧提供给 Desktop，Desktop 只合成；
- `prismarine-viewer` 降级为无客户端时的备用，不再作为“原版渲染”路线。

## 帧捕获的正确方式

- 在**渲染完成后**抓 framebuffer / screenshot，光影自然保留；
- 低频展示可先复用 mcpfabric 的截图能力；
- 需要连续视频时，再写一个小型帧捕获 mod，把帧序列推给 Desktop；
- Desktop 不需要知道 shader、chunk、材质，只接收像素。

## 下一步

1. 在 WSL 准备原生 MC 客户端（Fabric + mcpfabric + Iris）；
2. 先用 mcpfabric 的 MCP 工具验证移动/视角/观测/截图；
3. 把截图帧源接入 Desktop 的 pixel surface；
4. 需要连续帧时，再实现轻量帧捕获 mod。
