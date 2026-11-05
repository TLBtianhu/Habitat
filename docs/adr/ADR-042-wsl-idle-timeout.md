# ADR-042：禁用 Habitat 所需的 WSL 空闲自动关机

日期：2026-11-05
状态：Accepted（WSL 不再空闲关机，QQ 与 OneBot 已恢复）

## 证据

- `journalctl --list-boots` 显示 WSL 在一分钟内多次启动，而不是 NapCat 单独重启。
- 上一次启动的末尾出现 `systemd poweroff`，以及 WSL `InitTerminateInstanceInternal` 在等待 10000ms 后强制断电。
- Windows 没有持续运行的 `wsl.exe` keepalive 进程。
- 原 `.wslconfig` 未设置 `vmIdleTimeout` 或 `instanceIdleTimeout`，分别使用默认 60000ms 和 15000ms。
- 微软文档给出默认值；WSL 源码明确：实例空闲超时小于 0 不注册终止回调，VM 空闲超时小于 0 会持续运行，直到显式 `wsl --shutdown` 或服务停止。

## 决策

在 `%UserProfile%\.wslconfig` 保留原网络配置，增加：

```ini
[wsl2]
vmIdleTimeout=-1

[general]
instanceIdleTimeout=-1
```

这是影响所有 WSL2 实例的全局设置，适合主人明确要求持续运行的 Habitat。修改前保留 `.wslconfig.habitat-backup-20261105`，不写入公开仓库。

`vmIdleTimeout=-1` 不是禁止正常停机：Owner 的停止入口、systemd stop 和显式 `wsl --shutdown` 仍然有效。

## 验证要求

- 配置重启后记录新的 boot id，随后跨越多个原空闲关机周期，boot id 不变；
- NapCat 运行容器启动时间不变；
- `CheckLoginStatus`、OneBot `get_status`、`get_login_info` 和 Agent `/qq/status` 均恢复；
- 不把 NapCat、Docker 或 hostname 的日志单独当作 VM 反复重启的根因。

实际验证中，配置后经过多次原 60 秒空闲周期，`uptime -s` 和 boot id 均未变化，NapCat 启动时间保持不变。最终 `CheckLoginStatus` 返回 `isLogin=true、coreReady=true`，`get_status` 返回 `online=true、good=true`，`get_login_info` 返回真实账号，Agent `/qq/status` 为 ready，且没有再次要求刷新二维码。

参考：[Microsoft WSL 配置文档](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)、[WSL 实例空闲终止实现](https://github.com/microsoft/WSL/blob/master/src/windows/service/exe/LxssUserSession.cpp#L2952-L2968)、[WSL VM 空闲终止实现](https://github.com/microsoft/WSL/blob/master/src/windows/service/exe/LxssUserSession.cpp#L4198-L4217)。
