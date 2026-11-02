# SPEC-07 观测编译器（冻结候选）

> 版本：v0.1 草案 · 状态：待审
> 上位：`design/perception.md`（四个世界）、`research/mc-agent-perception.md`（Voyager / mindcraft 实证）
> 一句话：**事件进泵，快照进模型；能符号化的不给图。**

---

## 1. 职责

`observer` 住在 Authority，唯一职责：把**真世界投影**编译成一帧**观测**，喂给模型。

它不做：决策、渲染、记忆检索（记忆由 §6 单独注入）。

**O-1** 观测**必须**是快照，不是事件流；事件只能以摘要形式出现。
**O-2** 观测**必须**可按相位切换模板（`play` / `code` / `verify` / `offline`）。
**O-3** 观测**必须**有 token 预算，超预算时按 §4 的顺序裁剪，**严禁**截断 JSON 导致不可解析。

---

## 2. 观测帧（play 模板）

```jsonc
{
  "t": "obs", "at": 1730000000, "mode": "play",
  "self": {
    "pos": [12, 64, -8], "facing": "north",
    "health": 18, "food": 16, "held": "iron_axe",
    "equipment": { "helmet": null, "chestplate": "iron_chestplate", "mainHand": "iron_axe" }
  },
  "action": { "current": "chop_tree", "isIdle": false, "elapsedMs": 4200 },
  "task":   { "id": "chop_tree", "step": 2, "of": 3, "progress": 0.4, "blocked": false },
  "nearby": {
    "blocks":   [ {"name":"oak_log","n":6,"nearest":3.2}, {"name":"stone","n":14,"nearest":1.0} ],
    "entities": [ {"name":"zombie","n":1,"nearest":8.1} ],
    "players":  ["小鱼干"]
  },
  "inventory": { "used": 12, "total": 36, "counts": {"oak_log":12,"stick":4,"iron_axe":1} },
  "world": { "time": "afternoon", "weather": "clear", "biome": "forest", "dimension": "overworld" },
  "events": [ {"k":"damage","from":"zombie","hp":18}, {"k":"chat","who":"小鱼干","text":"你后面有僵尸"} ],
  "lastFail": null
}
```

**O-4** `action.current` 与 `isIdle` **必须**存在——否则模型会重复下同一条命令（mindcraft 实证）。
**O-5** `nearby` **必须**是"名字 + 数量 + 最近距离"，**严禁**输出坐标表（Voyager 实证：符号足够）。
**O-6** `events` **必须**已去重、已按显著度排序、**最多 5 条**；更早的折叠成 `{"k":"folded","n":12}`。

## 3. 观测帧（code 模板）

```jsonc
{
  "t": "obs", "at": ..., "mode": "code",
  "file": "skills/chop-tree/index.mjs",
  "cursor": { "line": 42, "col": 8 },
  "diffSinceLast": "+ if (block.name === 'oak_log') await dig(block)",
  "test": { "status": "failed", "name": "chops 3 logs", "error": "TypeError: dig is not a function" },
  "artifact": { "id": "chop-tree", "version": "1.3.0", "caps": ["mc.dig","mc.moveTo"] },
  "recentEdits": ["+12 -3", "+0 -0"]
}
```

**O-7** code 模板**严禁**带世界状态（玩家坐标、背包）——那是另一个相位的事。相位隔离同样适用于观测。

---

## 4. 预算与裁剪顺序

| 预算 | 值 |
|---|---|
| 常规观测 | ≤ 600 token |
| 带图 | ≤ 1000 token |
| 事件 | ≤ 5 条 |

超预算按此顺序裁：`events` 折叠 → `inventory.counts` 只留前 15 → `nearby` 只留前 8 → `lastFail` 截断到 200 字。

**O-8** **严禁**裁 `self` / `action` / `task` 三个块——它们是判断的锚点。

---

## 5. 视觉：两级，默认转述

| 级别 | 内容 | 成本 | 触发 |
|---|---|---|---|
| `caption`（默认） | 小模型把 320×180 截图转一句文字 | ~80 tok | 每轮或按需 |
| `image` | 原图直入主模型 | 200–400 tok | 空间判断（对齐/找路/看 UI） |

**O-9** 默认**必须**用 `caption`；只有 `task.needsSight === true` 时才用 `image`。
**O-10** `caption` 的生成方（vision 小模型）**必须**可替换、可关闭；关闭时返回"视觉不可用，请用符号判断"。
**O-11** 截图**必须**来自出口侧 `perceive` 渲染档（320×180），**严禁**让 Worker 渲染。

---

## 6. 记忆注入（与观测分家）

**O-12** 长期记忆**不得**混进观测帧；它以独立段落注入：

```
[MEMORY] 你答应过 actor:8842 下次带他看矿洞（第 3 代起未兑现）。
[RECENT] 上一场你在这棵树下被僵尸打死过一次。
```

**O-13** 记忆检索按"提到的人 / 承诺 / 当前任务"三条键，**最多 3 条**，每条 ≤ 40 字。

---

## 7. 失败语义

| 情况 | 行为 |
|---|---|
| 世界数据缺失 | 观测照发，对应块置 `null` 并加 `"degraded": true` |
| 事件队列溢出 | 只保留最近 50 条，其余折叠计数 |
| 编译超时（>100ms） | 发上一帧 + `"stale": true`，**严禁**阻塞泵 |

**O-14** 观测**必须**可在 100ms 内产出；它跑在泵的同一线程，**严禁**做 IO 或模型调用。

---

## 8. 可执行不变量

| # | 不变量 | 验证 |
|---|---|---|
| I1 | 观测无坐标表（只有 name/n/nearest） | schema 校验 |
| I2 | `action.current`/`isIdle` 必存在 | schema 校验 |
| I3 | events ≤ 5 且去重 | 属性测试 |
| I4 | 超预算按 §4 顺序裁，且 JSON 可解析 | 单元测试 |
| I5 | 100ms 内产出（合成 10⁴ 方块输入） | 性能测试 |
| I6 | code 模板不含世界字段 | schema 校验 |
| I7 | 关闭视觉时返回明确文案，不静默 | 单元测试 |

---

## 9. 待拍板

1. **`caption` 用哪个小模型**？（本地 2B / 云端便宜视觉模型 / 直接复用主模型）
2. **观测频率**：空闲 0.2 Hz、执行中 1 Hz、事件立即——是否够？
3. **`inventory` 顶部 15 个**是否够（她可能要找冷门材料）？
