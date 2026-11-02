# ADR-014：Owner-approved 签名插件安装

> 2026-11-02 · 从 `habitat-plugins` 签名索引安装独立应用插件。

## 决定与实现

- `control/plugin-installer.mjs` 读取签名索引、`index.sig.json` 和公钥，验证 Ed25519 签名；
- 只有 owner 才能通过 `POST /plugins/install` 安装，模型、群消息和普通用户不能安装；
- 下载制品后校验 SHA256，撤销插件拒绝安装；
- 使用 Python `zipfile` 做路径穿越、大小和 symlink 检查，再交给本地 `PluginRegistry`；
- 安装目录按 `adapters/<app>` 注册，支持独立应用包，不把整个 Habitat 主仓库复制进插件；
- `tools/install-plugin.mjs` 只通过 Control API 调用安装，不能绕过 owner 校验。

## 实际验收

- 自包含签名索引、制品和临时密钥测试通过；
- `qq.reply` 安装后可被 PluginRegistry 发现；
- 坏哈希、撤销插件、无效签名、非 owner 安装和路径穿越均被拒绝；
- GitHub Actions：Linux/Windows 主 CI 与 runtime-smoke 全部通过；
- `habitat-plugins` 仓库 CI：构建、签名、哈希和独立加载全部通过。

## 实际远程安装

- 已从 `habitat-plugins` 的真实 GitHub 签名索引和 Release 制品安装 QQ、B站、MC 三个应用；
- Registry 实际发现 `qq.reply`、`mc.obs`、`mc.say`、`mc.look`、`mc.stop`；
- 已验签索引缓存在本地 24 小时，远程暂时不可用时只复用已验证内容；无效签名不回退；
- 下载支持 Node fetch 重试和 curl 回退，所有制品仍必须验证 SHA256。

## 使用

```bash
# 通过 Control API 由主人安装，Control 必须已在运行
node tools/install-plugin.mjs qq
```

默认索引为 `https://github.com/TLBtianhu/habitat-plugins/releases/latest/download/index.json`。可用 `HABITAT_PLUGIN_INDEX_URL` 替换为镜像或私有签名索引，`HABITAT_PLUGIN_CACHE` 指定安装缓存。

## 边界

- 安装/升级需要当前远程签名索引；撤销缓存用于离线禁用，运行中停用由 InstalledPluginSupervisor 立即执行；
- HLS 自 ADR-018 起作为独立 outlet 插件发布，通过 Core capture 接口依赖 Desktop/Audio；
- 插件许可独立于 Habitat 本体 MIT，安装不自动获得额外系统权限。
