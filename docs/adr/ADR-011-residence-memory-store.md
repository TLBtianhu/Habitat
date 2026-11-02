# ADR-011：分场所持久记忆

> 2026-11-02 · ResidenceMemoryStore：按 residence 分文件、TTL、脱敏、重启恢复与 owner-approved 共享。

## 决定与实现

- `agent/residence-memory-store.mjs` 按 scope 的哈希文件名保存 JSONL，避免路径穿越和跨场所串文件；
- `system` 默认 persistent，QQ 私聊默认 residence（默认 30 天 TTL），群/B站默认 ephemeral，不写长期档案；
- 写入前脱敏 Bearer、SESSDATA、streamKey、API key，限制单条长度；
- 重启读取并过滤过期项，`compact()` 原子重写活动记录；
- `workingSet/recall` 默认只读 system，其他 residence 必须显式指定 scope；
- `share()` 只允许 owner 批准，保留 `sharedFrom`、原 scope、原 item id、共享时间和目标 residence，禁止模型自行跨场所复制；
- Agent 停机时压缩活动记忆，普通运行中的 scope 查询不互相穿透。

## 实际验收

- `agent/verify-residence-memory-store.mjs`：持久化恢复、TTL、脱敏、residence 隔离、owner-approved 共享全部通过；
- 真实 `/var/lib/habitat/memory` 写入后重新实例化，成功恢复；测试 scope 文件已清理；
- `agent/verify-memory.mjs` 原有衰减/检索与新增 scope 测试通过；
- 既有 SkillRuntime、PhaseMachine、PluginRegistry、MCP、EventPump、Outbox、ResidencePolicy 回归通过。

## 尚未覆盖

- 当前是 JSONL 文本记忆，不是向量/语义检索；
- `share()` 是受控复制事实，不是跨场所全文同步；
- 记忆库尚未做跨进程单写者锁、加密静态存储和完整语义删除/遗忘工作流；
- 群/B站默认 ephemeral 的策略不意味着消息不会被平台本身保存。
