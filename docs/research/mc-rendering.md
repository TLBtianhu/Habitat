# 调研：别人怎么把 MC 画出来，以及我们为什么只看到天空

> 2026-10-31 · 对象：prismarine-viewer 的内部机制、mindcraft 的两套渲染、Voyager 的做法
> 结论：**成熟项目都"从玩家自己的世界"渲染**；我们失败是因为让一个独立相机 bot 客户端瞬移——服务端不会为它补发区块。

---

## 1. 三种成熟的渲染路线

| 项目 | 怎么画 | 关键点 |
|---|---|---|
| **Voyager** | 不画 | 纯协议 bot，只吃状态；渲染不是它的目标 |
| **mindcraft / 浏览器视图** | `mineflayerViewer(bot, {firstPerson:true})` | **在 bot 自己身上**挂 viewer —— bot 是服务端承认的玩家，区块自然有 |
| **mindcraft / 视觉相机** | Node 里 headless：`Viewer` + `WorldView(bot.world)` + `node-canvas-webgl`，离屏 800×512 抓 JPEG | 同样**用 bot 自己的 world** 建 WorldView；不依赖浏览器 |
| 真客户端（OBS 抓画面） | 开真 MC 客户端 | 最真，但要账号、GPU、窗口，且不受我们控制 |

**共同点：渲染器的世界数据来自"玩家自己的 bot.world"，不是从别处瞬移过来的相机。**

---

## 2. prismarine-viewer 的工作方式（为什么我们会见到天空）

```
浏览器页面（three.js）
   ▲ socket.io：chunk 数据 + 实体增量
服务端 lib/mineflayer.js
   └─ WorldView(bot.world, viewDistance, bot.entity.position)
        ├─ 订阅 bot 的 chunkColumnLoad / blockUpdate
        └─ 在 'move' 时 updatePosition() → 为新位置请求/构建网格
```

它画什么，完全取决于 **bot.world 里有哪些区块**。

而 MC 服务端只为**它认为你在的位置**发区块。我们的相机 bot 用 `bot.entity.position.set(...)` **在客户端瞬移**：
服务端眼里它还站在出生点 → 只发出生点的区块 → 新位置一片虚空 → **画面是天空**。

这不是 bug，是协议语义：**位置以服务端为准**。

---

## 3. 三条修法，按代价排序

| 方案 | 做法 | 代价 | 真实性 |
|---|---|---|---|
| **A 服务端 `/tp` 跟拍**（推荐） | 服务器给相机 bot 发 `/tp`（RCON 或 OP），区块按服务端位置补发 | 低：开 RCON、每秒一条命令 | 真 MC 渲染 |
| B 世界镜像到宿主 | 把 chunk 数据从沙箱推给宿主，宿主自建 WorldView | 高：chunk 体积大、要维护镜像 | 真 MC 渲染 |
| C 自绘 three.js | 用我们自己的 `world` 快照在宿主画体素 | 中：要扩到 3D 方块体、自己做贴图/雾 | 风格化，不是原版 |

**A 的本质**：第一视角的相机必须是**服务端承认的玩家**。这和"观众看的是她的视角"完全一致——相机就该是她的一个替身，位置由服务端裁决。

---

## 3.5 根因（2026-10-31 晚定位）

不是区块问题，是**版本不匹配**。

`prismarine-viewer@1.33.0`（最新）的 `viewer/lib/version.js`：

```js
const supportedVersions = ['1.8.8', ..., '1.20.1', '1.21.1', '1.21.4']
function getVersion (version) {
  if (supportedVersions.indexOf(version) !== -1) return version
  const major = toMajor(version)                 // '26.1' -> '26.1'
  if (lastOfMajor[major] === undefined) return null   // ← 26.1 落在这一行
  ...
}
```

客户端收到 `version` 事件后：

```js
o.on('version', (t) => { if (!u.setVersion(t)) return !1; ... })
```

`setVersion('26.1')` 拿不到映射 → 返回 false → **客户端静默放弃整个初始化**，只剩一个空 three.js 场景 → 我们看到的天空。

**旁证**：RCON `/tp` 跟拍是成功的（相机 bot 拿到 213 个区块，位置也跟上了），所以链路与区块都没问题，只有"版本"这一关卡着。

---

## 3.6 决策

| 方案 | 做法 | 代价 |
|---|---|---|
| **A 世界降到 1.21.4**（推荐） | 换服务端 jar（BMCLAPI 可下，56.8 MB）；mineflayer 4.39 支持；viewer 支持；NeoForge 用 21.1.x | 世界版本旧一点；存档要重生成（版本降级不能复用） |
| B 自绘渲染器 | 用我们自己的 `world` 快照画体素 | 1–2 周才有像样的画面；风格化而非原版 |
| C 等 viewer 支持 26.1 | —— | 不可控 |
| D 真 MC 客户端做相机 | 最真 | 要账号、GPU 窗口、OBS 抓窗 |

**A 的理由**：它让"渲染、协议、模组"三者**对齐到同一个被广泛支持的版本**；B 是唯一不依赖版本的路，但视觉和工期都更贵。

---

## 4. 顺带：视觉（给模型）也走同一条路

mindcraft 的 `camera.js` 证明了：**headless 渲染不需要浏览器**——Node + `Viewer` + `WorldView` + `node-canvas-webgl` 就能出 JPEG，800×512。

这对我们的意义：

- 如果哪天要在宿主做"给模型的截图"，可以直接用同一套，不需要再起浏览器；
- 但它仍然要求 **world 数据在渲染侧**——所以要么 A（服务端 tp，区块自然到），要么 B（镜像）。

---

## 5. 结论

> **渲染不是"把画面搬过来"，是"让渲染器拥有那个世界"。**
> 观众要看第一视角，就让相机成为一个服务端承认的玩家（A）；模型要判断，就给符号（已有 obs）。
> 我们之前把"相机"做成了一个客户端木偶，所以它看见的是虚空。
