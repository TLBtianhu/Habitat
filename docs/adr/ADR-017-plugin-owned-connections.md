# ADR-017：插件拥有真实连接生命周期

> 2026-11-02 · QQ/B站/MC 不再只是“独立工具文件”，而是拥有真实连接 runtime 的独立应用。

## 实现

- QQ 插件包创建 `OneBotClient` 与 `OneBotConnectionSupervisor`，拥有 WS 启停、状态、事件队列和 `qq.reply` 执行上下文；
- B站插件包创建只读 `BiliConnectionSupervisor`，manifest 只声明 `live.read`，不再声明未实现的写/推流权限；
- MC 插件包创建 `NativeMcClient`，没有本地持久连接时不伪报在线；
- `PluginRegistry` 统一持有 runtime 的 `start/stop/status`，支持 `suspend/resume/stopAll`；
- `InstalledPluginSupervisor` 监听本地安装状态，停用、撤销或卸载后立即停止 runtime；
- `AgentLoop` 不再直接导入或启动内置 QQ/B站/MC 连接类，只读取插件 runtime 的观测和状态；
- 连接停止会清空待处理消息并取消重连，避免恢复后处理过期消息。

## 实际验收

- 插件 runtime 启停、停用、恢复、卸载和调用隔离测试通过；
- 真实 AgentLoop 中停用 QQ 后：状态为 stopped、`nextRetryAt=0`、pending 为 0，Presence 为 disabled/offline；
- owner 重新启用后 QQ 恢复真实 degraded 状态，没有伪报 ready；
- QQ/B站/MC 最终安装包与签名索引 SHA256 逐一一致；
- 当前 QQ 仍 degraded，没有进行真实 QQ 发送；B站保持只读且未配置时 disabled。

## 发行

签名索引、撤销列表和公钥同时托管在 GitHub Release `latest/download`，避免只依赖 raw 文件域名。远程索引获取失败时只允许使用已验签的 24 小时缓存，不能用无效签名替代。
