# QQ / B站机器人：它们如何面对世界

## 共同结论

QQ 和 B站的成熟机器人都不靠屏幕。它们把世界拆成：
**事件流（发生了什么） + 结构化状态（当前是什么） + 动作（能做什么）。**
这与 Habitat 的 **obs（文本事件/状态） vs present（观众像素）** 完全一致。

## QQ：OneBot / NapCat / go-cqhttp / NoneBot / oicq / Mirai

### 世界模型

- **事件流**：`message`、`notice`、`request`、`meta_event`
- **结构化状态**：`user_id`、`group_id`、`sender`、`message_id`、`time`、`self_id`、`post_type`
- **消息内容**：`message`、`raw_message`、消息段（文本/图片/At/表情/回复）

### 动作

- `send_msg` / `send_group_msg` / `send_private_msg`
- `get_msg` / `delete_msg`
- `set_group_kick` / `set_group_ban` / `set_group_admin`
- 上传图片、撤回、戳一戳、群公告、群文件

### 关键特点

- **不是“看屏幕”，而是“读事件”**；
- 有联系人/群/权限等**结构化状态**；
- 动作是显式 API 调用，有作用域和权限。

## B站：blivedm / bilibili-live-ws / 直播协议

### 世界模型

- **事件流**：`DANMU_MSG`、`SEND_GIFT`、`WELCOME`、`ENTRY_EFFECT`、`INTERACT_WORD_V2`、`ONLINE_RANK_*`、`WATCHED_CHANGE`、`ROOM_*`
- **结构化状态**：`room_id`、`uid`、`uname`、`online`、`watched`、`rank`、`room_info`
- **消息内容**：弹幕文本、礼物、进场、点赞、关注、房管、禁言、切换直播状态

### 动作

- 读直播间信息、视频信息、评论、动态、用户、历史、收藏
- 发弹幕（若权限允许）、评论、点赞、关注、发动态
- 直播协议里的 token / host / uid / buvid / WBI 签名

### 关键特点

- **也是“读事件”，不是“看画面”**；
- 有直播间/房间状态（在线、 rank、 watched、房间信息）；
- 动作同样是显式 API/协议调用，有权限与风控。

## 对 Habitat 的映射

| 机器人概念 | Habitat 对应 |
|---|---|
| 事件流 | `obs.events` |
| 结构化状态 | `obs.self / obs.nearby / obs.world / apps` |
| 动作 | `walk / dig / say / send / danmaku / app.open` |
| 权限与作用域 | Identity scopes / broker capability |
| 不用屏幕 | **obs 不需要 present.frame** |

## 结论

QQ 和 B站机器人给我们的最大印证是：
**AI 面对世界的方式应该是“事件 + 状态 + 动作”，不是“截图”。**
大肥鱼的感知应该是纯文本事件；渲染只给观众看。
