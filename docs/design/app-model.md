# 能力服务、客户端适配与应用焦点模型

> 2026-10-31 · 两个问题：不依赖具体客户端的能力怎么放？她是否理解“打开/关闭应用、当前在用哪个应用”？

## 1. 两种 MCP 能力，不要混

### A. 客户端动作（client action）

依赖具体客户端协议与格式：

- `mc.walk`、`mc.dig`、`mc.say`
- `qq.send_text`、`qq.send_sticker`
- `live.push`

这些必须以 `client.verb` 命名，因为它们的意义依赖客户端。

### B. 客户端无关的能力服务（capability service）

不依赖某个客户端软件，只产生标准产物：

- `voice.speak` → `AudioArtifact`
- `display.present` → `SceneDescriptor`
- `memory.remember` → 记忆条目
- `vision.describe` → 稀疏声明
- `artifact.build` → 模组/插件 artifact

**服务只生产标准产物，客户端决定怎么投递。**

例如语音：

```
voice.speak(text)
  → AudioArtifact（PCM + RMS + 时长）
      ├─ QQ 客户端：编码成语音消息
      ├─ Live 客户端：混成直播音轨
      └─ Display Server：驱动口型
```

**产生语音是能力，发语音是客户端动作。**

## 2. 她需要的不只是工具列表，而是“应用模型”

如果她眼里只有平铺的 MCP 工具，她无法回答：

- 我现在打开着哪些软件？
- 我正在用哪一个？
- 哪些在后台跑？
- 我该把哪个切到前台？

所以要加一层 **AppRegistry + AppSession**：

```ts
type AppState = 'closed' | 'open' | 'background' | 'focused';

type AppSession = {
  appId: 'qq' | 'mc' | 'live' | 'ide' | 'browser';
  state: AppState;
  identityId?: string;
  worldId?: string;
  openedAt: number;
  lastEventAt: number;
};
```

她应该能发出这些**应用级意图**：

- `app.open('qq')`
- `app.close('ide')`
- `app.focus('mc')`
- `app.background('qq')`

这些和 `mc.walk`、`qq.send` 不是一个层级：**一个管“用哪个应用”，一个管“在应用里做什么”。**

## 3. 当前应用与虚拟任务栏

Display Server 的任务栏不应自己猜，而是从 AppSession 投影：

```
[ MC · focused ] [ QQ · background ] [ IDE · closed ] [ live · open ]
```

- **focused**：她当前正在使用的应用，对应主画面；
- **open/background**：仍开着、仍在接事件，但不占主画面；
- **closed**：没有 surface，也不该有客户端工具。

于是“打开/关闭应用”和“显示器底部任务栏”就是同一份状态的两份投影：

- 给她：`app.current` 与 `app.open`；
- 给观众：任务栏与当前画面。

## 4. AI 布局与人类布局的妥协

不要给她像素窗口管理，也不要给观众一堆无意义平铺。用**语义布局**：

| 她的意图 | 显示器的呈现 |
|---|---|
| `app.focus('mc')` | MC 主画面，其他缩到任务栏/角落 |
| `app.background('qq')` | QQ 退到后台，只保留任务栏徽标 |
| `app.present('qq')` | QQ 临时全屏展示，结束后回到原焦点 |
| `app.share('ide')` | IDE 进入共享/直播画面 |

**她说的是“关注什么”，Display 决定“怎么摆给人看”。** 这就是 AI 语义与人类视觉惯性之间的妥协层。

## 5. 后台任务与注意力

后台应用仍然可以产生事件：

- QQ 来消息 → QQ 任务栏出现徽标；
- IDE 测试完成 → IDE 任务栏变色；
- MC 血量危险 → 请求 `app.focus('mc')`。

她不需要“最小化/缩放窗口”的概念，只需要：

- **前台（focused）**：当前注意力；
- **后台（background）**：继续运行，但只占少量上下文；
- **关闭（closed）**：工具与 surface 都卸载。

## 6. 对观测模型的补充

`obs` 里应增加：

```json
{
  "app": {
    "current": "mc",
    "open": ["mc", "qq", "live"],
    "background": ["qq"],
    "attention": "world"
  }
}
```

这样她就明确知道“我正在用 MC，QQ 在后台”，而不是只看到一堆平铺工具。

## 7. 一句话

> **MCP 工具回答“我能做什么”，AppSession 回答“我正在用哪个应用”。**
> Display Server 的任务栏只是这份应用状态的视觉投影。
