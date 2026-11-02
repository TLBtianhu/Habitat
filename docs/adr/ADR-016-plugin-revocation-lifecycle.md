# ADR-016：插件撤销、停用与卸载

> 2026-11-02 · 撤销不止阻止安装，也阻止已安装插件继续注册和执行。

## 实现

- `revocations.json` 与 `revocations.sig.json` 使用同一发布公钥验证；
- 已验签索引缓存包含撤销列表，撤销状态在离线时也继续生效；
- owner 可通过 Control API 执行 `disable`、`enable`、`revoke`、`unrevoke`、`uninstall`；
- 被停用或撤销的安装插件不会进入 `PluginRegistry`，也不会回退到内置同 id 插件；
- `AdapterHost` 拒绝启动已停用或撤销的适配器；
- `unrevoke` 不会自动启用，必须再次由 owner 明确 `enable`；
- 卸载保留本地撤销记录，重新安装前必须解除撤销。

## 实测

- 本地签名撤销、坏哈希、非 owner 安装和路径穿越测试通过；
- Control HTTP 停用、启用、撤销、解除撤销和卸载测试通过；
- 真实 AgentLoop 重启后，停用 QQ 不再注册 `qq.reply`；
- 撤销 QQ 后不能启用，解除撤销并显式启用后恢复；
- 当前 QQ 连接仍 degraded，没有进行真实 QQ 发送。

## 运维

```bash
node tools/plugin-admin.mjs disable qq
node tools/plugin-admin.mjs enable qq
node tools/plugin-admin.mjs revoke qq
node tools/plugin-admin.mjs unrevoke qq
node tools/plugin-admin.mjs uninstall qq
```
