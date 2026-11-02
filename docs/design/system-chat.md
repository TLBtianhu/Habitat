# 系统对话与应用聊天：三个维度，不能混线

> 2026-11-01 · 系统对话不是“MC 离线时的降级功能”，而是 Core 自己常驻的能力。

## 1. 命名空间

| 通道 | 所属 | 参与者 | 权限与语义 |
|---|---|---|---|
| `system.chat` | Core / 控制台 | 主人、本地 viewer、大肥鱼 | 系统级对话；主人身份由 owner token 确认 |
| `app.bilibili.danmaku` | B 站应用 | 直播间观众、主播应用 | 普通应用事件，不是系统对话 |
| `app.mc.chat` | MC 世界 | 游戏内玩家、大肥鱼的游戏身份 | 世界内通信，不是控制台消息 |
| `app.qq.message` | QQ 应用 | 群友、好友、大肥鱼的 QQ 身份 | 协议事件，权限由 QQ 身份与管理员策略决定 |

任何应用是否在线，都不影响 `system.chat` 存在与运行。

## 2. 动作也不能混线

- `system.say`：只把文字发回控制台；
- `mc.say`：只把文字发进 MC 游戏聊天；
- QQ 发送、B 站直播语音回应分别是各自应用/出口的动作，不复用系统动作。

禁止把控制台消息自动转发进 MC，也禁止把弹幕或游戏聊天默认提升为主人指令。

## 3. Agent 观测结构

```jsonc
{
  "system": {
    "conversation": {
      "channel": "system",
      "recent": [],
      "new": []
    }
  },
  "mc": {
    "available": false
    // 在线时包含世界状态与游戏内事件，仍留在 mc 命名空间
  },
  "apps": {}
}
```

`recent` 用于上下文，`new` 用于触发决策。大肥鱼自己的消息会推进水位，但不会进入 `new`，避免自回复循环。没有新系统消息、也没有可用世界观测时，不空喊 LLM。

## 4. 身份与防冒充

- 控制台 POST 的身份由凭证决定：`owner` 或 `viewer`，忽略调用者提交的 `from`；
- 大肥鱼使用独立 agent token 调用 `/system/chat/agent`；
- owner token 不交给 Agent，系统对话能力不等于主人控制权限；
- 所有系统消息带单调递增 id，追加写入 `/var/lib/habitat/system-chat.jsonl`；控制面重启后恢复消息与 id 水位；
- Agent 把已读 id 原子写入 `/var/lib/habitat/agent-system-chat.json`，重启后继续补收，不重复回复；
- 第一次启动且没有水位文件时，以当前最新消息为基线，避免把历史消息一次性当新输入。

## 5. 当前验收

已在 MC、QQ、B 站均不在线时完成真实 LLM 对话：

1. owner 在控制台发送消息；
2. Agent 通过 `system.chat` 收到 `new`；
3. 使用 `system.say` 回复控制台；
4. 后续轮询没有产生自回复；
5. 无凭证调用者无法冒充 `dafeiyu`，也不能调用 agent 专用发言端点；
6. Agent 离线期间的留言，在控制面也重启后仍能补收并回复；
7. 控制面与 Agent 再次重启不会重复回复；
8. 控制台每 2 秒只刷新消息区，已验证新回复自动出现且未发送草稿不被清空。
