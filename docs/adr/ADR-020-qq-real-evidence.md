# ADR-020：QQ 真实恢复与回复证据

> 2026-11-02 · NapCat 登录恢复、真实收发、历史证据和 idempotency 去重。

## 实现

- QQ 插件新增 `getMsg` 与只读 `getGroupMsgHistory`；`get_msg` 缓存丢失时，只查询当前授权群的最近历史；
- `qq.reply` 的 AfterAction 同时要求：真实 `message_id`、可读取的已发送消息、residence 绑定和未重复发送；
- `ActionTracker` 按 idempotencyKey 合并同一 intent；旧数据可用 `refs.messageId` 归并，重复写操作标为 duplicate；
- broker 将实际 idempotencyKey 传给 tracker，SkillLibrary 不把它当成技能参数；
- root 写入 AfterAction 时继承状态目录的服务账号所有权，避免 AgentLoop 无法读取。

## 实际验收

- NapCat 经账号主人扫码与设备信任恢复，真实 `get_login_info` 成功；
- OneBot WS 为 ready，持续心跳推进；NapCat 重启后自动重连，connectionId 递增；
- 在已授权测试群收到真实消息，并执行一次策略允许的受限回复；
- Habitat outbox 为 `succeeded`，群历史找到同一 `message_id`，AfterAction 最终为 `verified_success`；
- 没有向其他群或私聊发送，没有重复发送，没有自动自回复；
- 当前 QR 临时文件已删除，账号 ID、token 和群号未写入公开仓库。

## 发行

- QQ 插件：`0.1.3`；
- 插件发布：`plugins-v0.1.6`；
- 主仓库新增 QQ 证据回退、idempotency 去重和 AfterAction 权限修复。
