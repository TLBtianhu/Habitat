# 调研：成熟 MC Agent 的"吃"与"吐"

> 2026-10-31 · 样本：**Voyager**（7.3k★, MIT, 2023）与 **mindcraft**（5.9k★, MIT, 仍在更新）
> 结论先说：**成熟方案都不喂事件流，都喂状态快照；都从"原始动作"往"工具调用/代码"上走；视觉都不直接把图塞给主模型。**

---

## 1. 两个样本

| | Voyager | mindcraft |
|---|---|---|
| 定位 | 学术标杆：LLM 写代码 + 技能库 + 自验证 | 工程标杆：多模型、工具调用、视觉、多 agent |
| 动作形态 | **JS 代码**（async 函数，复用技能库） | **文本命令** `!verb(args)`（也支持 `!newAction("代码")`） |
| 观测 | 固定字段 + 集合 + 增量 | 结构化 JSON + 命令文档 + 视觉转述 |
| 视觉 | 无 | 独立视觉模型，把截图转成文字再注入 |

---

## 2. Voyager 吃什么

`action_template.txt` 列得很清楚，每轮喂这些块：

```
Code from the last round   上一轮代码（提醒别复用）
Execution error            报错
Chat log                   聊天（增量）
Biome / Time / Health / Hunger / Position / Equipment
Nearby blocks              附近方块（8×2×8 范围内，**只有名字集合，没有坐标**）
Nearby entities (nearest to farthest)  实体名 → 最近距离
Inventory (xx/36)          物品名 → 数量
Chests                     箱子
Task / Context / Critique  任务、上下文、自评
```

**三个细节值得抄：**

1. **附近方块只给名字集合**（`voxels.js` 里是 `Set<block.name>`）——不给坐标、不给数量。信号足够（"这里有橡木和石头"），token 极省。
2. **实体只给"名字 → 最近距离"**，不给全量位置表。
3. **聊天是增量**（`onChat.js` 每次 observe 后清空），不是全量历史。

动作侧是**代码**，而且提示词里强制：

> 用 `mineBlock/craftItem/smeltItem/placeItem/killMob`，**不要直接用 `bot.dig` / `bot.craft`**。

即：**动作空间是"技能库 + 自由组合"，不是原始 API。** 这也是它能把技能沉淀成库的原因。

---

## 3. mindcraft 吃什么、吐什么

### 吃：一份结构化 `full_state`

```jsonc
{
  "gameplay": { "position": {x,y,z}, "dimension": "...", "gamemode": "survival",
                "health": 20, "hunger": 18, "biome": "...", "weather": "Clear",
                "timeOfDay": 6000, "timeLabel": "Afternoon" },
  "action":   { "current": "Collecting oak logs", "isIdle": false },
  "surroundings": { "below": "grass_block", "legs": "air", "head": "air",
                    "firstBlockAboveHead": "oak_leaves" },
  "inventory": { "counts": {"oak_log": 12}, "stacksUsed": 3, "totalSlots": 36,
                 "equipment": {"helmet": null, "chestplate": "...", "mainHand": "iron_axe"} },
  "nearby":   { "humanPlayers": ["..."], "botPlayers": [], "entityTypes": ["zombie"] },
  "modes":    { "summary": "..." }
}
```

注意 `action.current` / `isIdle`——**状态里必须包含"我正在做什么"**，否则模型会忘记上一轮的动作还在执行，反复下同样的指令。

### 吐：文本命令

```
!goToPlayer("Alice", 3)
!collectBlock("oak_log", 4)
!newAction("挖三格深坑再放水")
```

命令表在 `commands/index.js`：`!` + 驼峰名 + 括号参数（只允许数字/布尔/引号字符串）。解析器是一行正则——**刻意窄**，因为参数类型有限。

### 视觉：不是把图塞给主模型

`vision_interpreter.js` 的流程是：

```
bot.lookAt(...) → camera.capture() → 截图文件 → **独立的 vision 模型**
   → 返回一段文字分析 → 拼进主模型的上下文
```

也就是说：**看图的是另一个模型，主模型只读"看图的人说的话"。**

好处：
- 主模型上下文不被图像 token 挤爆；
- 视觉模型可以换（贵/便宜）；
- 失败可降级（返回 "Vision is disabled. Use other methods"）。

---

## 4. 五条被验证的结论（直接可用）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **事件 → 状态快照，不流式喂** | 两者都是"每轮拼一份状态"，不是把 tick 事件倒进去 |
| 2 | **符号优先**：能说"附近有橡木"就不给坐标 | Voyager 的 `voxels.js` 只产名字集合 |
| 3 | **动作空间要往上抽象**：原始动作 < 工具调用 < 代码 | Voyager 强制用技能库；mindcraft 用命令表 + `!newAction` |
| 4 | **视觉是"转述"不是"直传"** | mindcraft 用独立 vision 模型出文字 |
| 5 | **状态里必须有"当前动作/是否空闲"** | mindcraft `action.current`、`isIdle` |

---

## 5. 对我们规格的修正

对照 `docs/design/perception.md` 的观测帧，要补三处：

### 5.1 加 `action` 字段

```jsonc
"action": { "current": "chop_tree", "isIdle": false, "elapsedMs": 4200 }
```

理由：我们已经有任务队列，但观测里没告诉模型"上一条命令还在跑"。缺这个字段会导致重复下令。

### 5.2 附近物体改为"名字 + 最近距离"，不给坐标表

```jsonc
"nearby": {
  "blocks": [ {"name":"oak_log","n":6,"nearest":3.2}, {"name":"stone","n":14,"nearest":1.0} ],
  "entities": [ {"name":"zombie","n":1,"nearest":8.1} ]
}
```

比自己数坐标省一个数量级，且够用。

### 5.3 `perceive` 渲染分两级

| 级别 | 内容 | 成本 | 何时 |
|---|---|---|---|
| `caption`（默认） | 独立小模型把 320×180 截图转一句文字 | ~80 token | 每轮 |
| `image`（可选） | 原图直接进主模型 | 200–400 token | 空间判断、看 UI |

**默认用 caption**，这也解决了"沙箱没 GPU 怎么给视觉"——截图由出口侧的低预算渲染产出，转述由小模型做。

---

## 6. 我们比它们多的东西

| 能力 | Voyager | mindcraft | 我们 |
|---|---|---|---|
| 真源/执行分离 | ❌ 同进程 | ❌ 同进程 | ✅ Authority / Worker |
| 单向出站边界 | ❌ | ❌ | ✅ |
| 命令日志与回放 | 部分（代码日志） | ❌ | ✅ SPEC-02 |
| 相位机（玩/写分离） | ❌ | ❌ | ✅ SPEC-03 |
| 意图闸门（不可信输入） | ❌ | ❌ | ✅ SPEC-02 |

也就是说：**"模型吃啥吐啥"这块我们照着它们抄；"边界与生命周期"这块它们没有，是我们自己的。**

---

## 7. 一句话

> Voyager 证明了**代码是最好的动作空间**；mindcraft 证明了**视觉应该先被翻译成文字**；
> 两者都证明了**模型要的是快照，不是事件流**。
