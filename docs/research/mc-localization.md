# MC Agent 的定位与导航：不需要 topDown

> 2026-11-01 · 结论：**大肥鱼不需要 topDown。它只是一个调试可视化，不应成为她的感知模型。**

## 成熟 Agent 怎么定位

| 方法 | 来源 | 用途 |
|---|---|---|
| **协议位置** | `bot.entity.position`、`yaw`、`pitch` | 绝对坐标与朝向 |
| **附近查询** | 方块/实体名称、数量、最近距离 | 判断周围有什么 |
| **射线检测** | raycast | 确认准星对着什么 |
| **路径规划** | `mineflayer-pathfinder`（A*） | 真正从 A 到 B |
| **锚点记忆** | home/base/箱子/床等 waypoint | 长距离定位与返回 |
| **按需视觉** | 低清截图/视觉模型 | 只在符号信息不足时补充 |

## 已有项目的做法

- **Voyager**：位置 + 附近方块/实体 + 代码动作 + pathfinder；没有 topDown 地图。
- **mindcraft**：结构化 `full_state` + `action.current/isIdle` + pathfinder；视觉是独立补充，不是主定位方式。
- **mineflayer-pathfinder**：直接在体素世界里做 A*，支持 `GoalBlock`、`GoalNear`、`GoalXZ`、`GoalFollow` 等目标。

## 她真正需要的观测

```json
{
  "self": { "pos": [x,y,z], "yaw": 0, "pitch": 0 },
  "nearby": {
    "blocks": [{ "name": "oak_log", "n": 4, "nearest": 3.2 }],
    "entities": [{ "type": "creeper", "nearest": 7.3 }]
  },
  "action": { "current": "idle", "isIdle": true },
  "waypoints": { "home": [x,y,z] }
}
```

这些已经足够她决定“往哪走、挖什么、怎么回家”。**不需要一张俯视地图。**

## 决策

- 从 AgentLoop 与产品展示中移除 `topDown`；
- 只保留它作为**调试工具的可选可视化**，不进入她的感知模型；
- 导航改用 `mineflayer-pathfinder`，观测保持稀疏声明；
- 主画面只保留客户端真实像素。
