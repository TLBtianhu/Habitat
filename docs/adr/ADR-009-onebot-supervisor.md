# ADR-009：QQ OneBot 连接监督

> 2026-11-02 · QQ 监督器。代码/故障注入与真实私聊输入均已验证；只读输入已常驻，未开放自动发送。

## 决定与实现

- 新增 `OneBotConnectionSupervisor`，使用标准 `ws` 管理 OneBot WebSocket；
- `open / heartbeat / message / close / error` 分离处理，heartbeat 只维护连接，不触发 Agent；
- 群消息和私聊归一化为 `app.qq.message`，保留 `groupId/userId/selfId/messageType`；
- `message_id` 去重，自己的消息只记录不入队，避免自回复；
- 有界队列，超限显式 dead-letter，处理完成才出队；
- 连接失败指数退避 + jitter，认证失败进入 `auth_required`，不做紧密重连；
- 正常 `close()` 优先，1 秒后有界 `terminate()`；
- `run-continuous` 只有显式配置 `HABITAT_ONEBOT_WS_URL` 才连接，默认只读，不提供自动群回复工具；
- `/qq/status` 暴露连接/重连/待处理/死信状态，不包含 token；
- 当前 NapCat 本机 HTTP/WS token 为空，只允许 127.0.0.1；发行模式必须显式配置认证，禁止直接暴露到 LAN/公网。

## 已验证

- 模拟 OneBot：心跳、message_id 去重、自消息过滤、群隔离、背压死信、重连、认证失败、心跳超时和停止全部通过；
- WSL 部署与 `/qq/status` 默认 `disabled` 正常；
- PluginRegistry、EventPump、DurableOutbox 回归通过；
- NapCat 容器已恢复运行，登录二维码已提供给账号主人。

## 真实环境当前状态

- NapCat 已登录账号 `<QQ_ACCOUNT_ID>`，HTTP `/get_login_info` 与真实 WS 均返回 `ready`；
- 修正了 Docker 端口映射：127.0.0.1:3002→3002、3003→3001，并保留回滚容器；
- 已恢复并启用 OneBot HTTP/WS 配置，统一使用受保护 token；
- 已收到真实私聊“测试”，归一化为 `app.qq.message`，发送者/机器人身份、namespace 与 pending 行为正确；
- 已在主账号新建的“群聊A”中收到真实群消息，`groupId` 与 `messageType=group` 正确；
- 仅对该测试群发送一条受限回复，outbox 重试 `deduped=true`，没有重复发送；自己的消息未触发自回复；
- 测试 outbox 已清理，未把测试目标或发送能力开放给 Agent 自由调用；
- 常驻 Agent 已通过 systemd drop-in 启用**只读** QQ 输入，`/qq/status` 为 `ready`，没有自动回复；
- `ResidenceContext + ChannelPolicy` 已落地，新增 `qq.reply`：目标由策略绑定，不能由模型指定其他群/用户；
- 仅“群聊A”被主人配置为 `respond=addressed`，其他群和私聊仍默认只读；
- 真实 @ 消息已触发一次自动回复，outbox 为 `succeeded`，没有重复发送或自回复循环；
- 未开放通用 `qq.send_group` / `qq.send_private` 任意目标接口；现有 `qq.reply` 仍受 ResidencePolicy、allowlist、限频和 outbox 限制。

## 后续

1. 验证真实运行中的重连与重启去重；
2. 如需输出，先由主人指定允许测试的群/私聊目标，再实现受限发送；
3. 继续发行包签名、撤销与稳定升级验收。
