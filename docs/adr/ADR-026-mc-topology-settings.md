# ADR-026：MC 三种服务器拓扑与真实 RPC 设置

> 2026-11-03 · Minecraft World Server、mcpfabric RPC 和 Habitat Control 是三个不同角色，不能混为“MC 在 WSL”。

## 拓扑

- `local-wsl`：大肥鱼客户端在 WSL，连接 WSL 中已经运行的世界与 mcpfabric RPC；默认世界地址 `127.0.0.1:25565`，RPC 地址 `127.0.0.1:25600/rpc`。
- `windows-host`：主人联机房间在 Windows，大肥鱼仍在 WSL，通过主人填写的 Windows 主机地址与 RPC 连接；不自动修改防火墙或公开端口。
- `remote`：世界与 RPC 在其他设备，双方都是客户端；远程 RPC 必须使用 HTTPS，不能把 token 明文发到网络。

## 设置与生效

- 设置中心分别保存 topology、世界 host:port、mcpfabric rpcUrl 和 token；
- 启用前调用真实 `session.info`，失败不写配置、不推进配置修订；
- MC provider 的 `start()` 也必须通过 `client.info()` 才能进入 ready，开关本身不再代表在线；
- token 变更参与配置哈希，supervisor 只重启 AgentLoop；secret 不回显；
- 未配置真实 mcpfabric 世界时，不自动创建 vanilla 世界冒充可联机世界。

## 实际验收

- 三种拓扑配置均通过 schema 与校验规则验收；remote HTTP 被拒绝；
- local-wsl 通过本地 RPC 协议端点完成启用、禁用与 AgentLoop 重启；
- windows-host 和 remote 只完成配置规则测试，未伪造对应真实服务器；
- 原有 LLM 设置、崩溃恢复、共存和卸载测试继续通过。
