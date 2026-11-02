# ADR-015：已安装插件进入真实 AgentLoop

> 2026-11-02 · 独立应用包不再只是 Registry 测试对象。

## 实现

- `agent/run-continuous.mjs` 使用 `PluginInstaller.registry()` 合并已安装应用与内置 system/voice/desktop 插件；
- `PluginInstaller.registry()` 传递真实 `providerContext`，包含 `onebotClient`、ResidencePolicy 和当前 ResidenceContext；
- QQ 0.1.1 的生命周期改为 `provider`，不再让 AdapterHost 启动不符合其实现的 `server.mjs`；
- `adapter-host.mjs` 能发现已安装 B站适配器及其独立目录；
- `PluginManifest` 正式支持 `provider` 生命周期。

## 实测

- QQ/B站/MC 从真实 GitHub 签名索引与 Release 制品安装；
- AgentLoop 实际发现 `mc.obs`、`mc.say`、`mc.look`、`mc.stop`、`qq.reply`；
- 已安装 QQ provider 在测试中可启动并执行受限 `qq.reply`；
- 已验签索引支持 24 小时缓存，Node fetch 失败时使用 curl 回退；
- 当前真实 QQ 连接仍为 degraded，未宣称真实 QQ 发送已恢复。

## 边界

- 安装只改变本地插件目录，不自动启用或更新；
- 普通模型、群消息和观众不能安装、撤销或扩大插件权限；
- 应用插件的许可和第三方依赖不因 Habitat 本体 MIT 而改变。
