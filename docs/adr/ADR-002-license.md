# ADR-002 许可证与资源边界

> 状态：**已定**（2026-10-31）· 影响面：仓库结构、依赖选择、发布流程
> 结论：**核心 MIT，资源不进库，AGPL 适配器独立成包，外部二进制不打包。**

---

## 1. 背景

项目要做三件在许可上容易出事的事：

1. 直播别的游戏（Minecraft）；
2. 在同一仓库里接多个平台（B 站、抖音、YouTube……）；
3. 用 FFmpeg 做编码。

三者分别对应：游戏资源再分发、AGPL 传染、GPL 二进制打包。任何一处处理错，"MIT 发布"就变成空话。

---

## 2. 决定

### D1 核心代码 MIT

采纳性优先：技术价值 = 技术 × 可采纳性。不玩 copyleft 强制——防线在外部法律，不在许可证文本里。

### D2 资源：分层，而不是一律不进库

> 2026-10-31 修订：从"一律不进库"改为"**可进库，但必须分层标注**"，理由见 §D7。

| 资源 | 处理 |
|---|---|
| 默认角色 | `assets/placeholder/`（CC0，开箱即用） |
| 角色立绘 / Live2D / 语音模型 | 放 `assets-packs/<id>/`，该目录带**自己的** `LICENSE-ASSETS`；素材本体进 `.gitignore`，用 `fetch.mjs` 按需拉取 |
| 大肥鱼素材（社区作品 **CC BY-NC-SA 4.0**） | **允许**进 `assets-packs/whale-girl/`，但必须：署名完整、非商业声明、同协议共享；`model/` 不进 git |
| Minecraft 纹理 / 音效 / 语言文件 | **严禁**进库；运行时从用户本地客户端或官方 CDN 读取 |

### D3 平台适配器按许可分裂

| 平台 | 依赖 | 许可 | 处理 |
|---|---|---|---|
| B 站 | blivedm 思路自研 或 MIT 库 | MIT | 进核心仓库 `packages/platform/bilibili` |
| YouTube | 官方 Data API | —— | MIT，进核心仓库 |
| Twitch | Helix / IRC | —— | MIT，进核心仓库 |
| **抖音** | [DouyinLiveWebFetcher](https://github.com/saermart/DouyinLiveWebFetcher) | **AGPL-3.0** | **独立包 + 独立进程**，默认不安装；README 明写许可 |
| **TikTok** | [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector) | **AGPL-3.0** | 同上 |

**理由**：AGPL 的传染性在"同一程序"内成立；把适配器做成**独立进程 + 网络边界**，核心可保持 MIT。且 AGPL 的网络条款要求对使用者提供源码——独立仓库公开即可满足。

### D4 FFmpeg 只调用，不打包

- 以**外部进程**调用 `ffmpeg`，仓库不含二进制；
- 用户自装（或 `ffmpeg-static` 由用户自行决定并承担 GPL 义务）；
- README 写明"本项目不附带 FFmpeg 二进制"。

**理由**：调用 CLI 是"聚合"而非"链接"，不构成衍生作品；一旦打包进发行包，就变成分发 GPL 软件。

### D5 OBS 只作人工预览

不链接 OBS、不嵌入 obs-multi-rtmp（GPL-2.0）。OBS 仅作为人类主播的应急/预览工具存在于文档里。

### D6 Minecraft 的商标与免责

- 项目名**不得**以 "Minecraft" 开头或作为主导词（官方 Usage Guidelines 明文）；
- 可作副标题（`Fishbowl: a streamer for Minecraft`）；
- README 首页必须含：

  > NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

- 不实现"付费解锁游戏内容"、不把游戏资源当卖点、不用它推广无关商业产品。

### D7 素材包分层（2026-10-31）

**背景**：社区里大量项目直接用鲸鱼娘直播，原作者开放二创、默认容忍；一律禁止进库既不现实，也不利于用户开箱即用。

**但**：署名只满足 CC 的「BY」，不满足「NC / SA」。真正的红线不是"被追责"，而是**元数据撒谎**——把非商业素材标成 MIT 交给下游。

**决定**：采用与上游 `dsh-whale-girl-live2d` 相同的分层法——

1. 根 `LICENSE` = MIT，只覆盖代码；GitHub 仍识别为 MIT；
2. `assets-packs/<id>/` 自带 `LICENSE-ASSETS` + `NOTICE.md`，声明真实许可与署名链；
3. 素材本体 `model/` 进 `.gitignore`，由 `fetch.mjs` 拉取，**不进 git、不进 npm**；
4. 装了该素材包的实例整体**非商业**；想商用的用户换 CC0 或自有形象；
5. 营利性使用（带货/周边/赞助）**不在授权范围**，风险由使用者自负，项目不背书。

---

## 3. 后果

**好的**
- 核心可以无摩擦地被任何 agent 项目采用（DSH / OpenHands / 自研）；
- 抖音支持可选，不污染 MIT 主仓；
- 素材包分层后**开箱可用**：默认 CC0 占位，想要鲸鱼娘一条 `fetch.mjs` 命令；
- 许可元数据诚实：根 LICENSE 仍是 MIT，素材的真实许可写在它自己的目录里。

**坏的**
- 开箱即用性下降：用户要自备角色素材、自装 FFmpeg、自备 MC；
- 抖音适配器分成两个仓库，维护成本略高；
- AGPL 适配器的使用者需要知道自己在用 AGPL——文档必须写清。

---

## 4. CI 检查

1. 依赖扫描：核心 `package.json` 里出现 GPL/AGPL 依赖 → **失败**；
2. 二进制扫描：仓库出现 `ffmpeg*`、`*.dll`、`*.so` → **失败**（测试夹具除外，需白名单）；
3. 资源扫描：`assets/` 下出现 `*.png/*.psd/*.vrm/*.model3.json` 且非 `placeholder/` → **失败**；
   `assets-packs/*/model/**` 出现任何文件 → **失败**（必须被 gitignore，由 fetch 脚本拉取）；
   `pack.json` 缺 `license`/`attribution` 字段 → **失败**；
4. 免责声明存在性：README 缺免责段落 → **失败**。

---

## 5. 备选（未采纳）

- **全 AGPL-3.0**：能吸收 AGPL 适配器，但会劝退想在公司内试用的团队；
- **MIT + 闭源适配器**：违反"对外交付层从众"的直觉，且抖音官方 API 门槛更高；
- **双许可**：现阶段没有商业诉求，属过度设计。
