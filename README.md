# Habitat

Habitat 是一个多场所 AI 运行时：大肥鱼可以在系统控制台、QQ、B站和 Minecraft 中活动，但人格、任务状态和社交记忆不再混成一个全局聊天框。

## 当前能力

- 'manifest + provider' 插件化应用与工具注册；
- 'ResidenceContext + ChannelPolicy'：按场所控制回复、限频、目标和权限；
- 'Episode + MemorySlice'：统一当前任务，同时保留分域社交记忆；
- 持久化事件泵、Durable Outbox、AfterAction 证据验收；
- QQ OneBot、B站 WSS、MC mcpfabric、Voice/Desktop/Outlet 适配器；
- 本地 Kokoro 语音、可撤销捕获 token、真实 Outlet 进程监督；
- 用户目录安装、staging 升级、坏包回滚和发行权限验收。

**默认只读/本地优先**：不自动公开推流、不自动向任意群发送、不控制宿主显示和输入。控制台/Control API 才是最高权威的主人交互面。

## 快速验收

~~~bash
npm install
node agent/verify-episode.mjs
node agent/verify-memory-slice.mjs
node agent/verify-residence-policy.mjs
node adapters/verify-plugin-registry.mjs
~~~

WSL 发行安装属于 provisioning，详见 'docs/ops/'。普通源码验收不需要管理员/root。

## 分发形态

| 形态 | 用途 | 数据位置 |
|---|---|---|
| 编译中间物 | 仅用于生成发行物，不是分发形态 | 不写设置、缓存或索引，不给用户直接使用 |
| 便携版 | 可移动、自包含副本 | 程序目录旁，不碰注册表 |
| 安装版 | 系统/用户安装、文件关联和卸载 | 用户配置目录，卸载保留数据 |

三者路径和数据路径分离，可以同机并存。详见 'docs/distribution/forms.md'。

## 运行时与插件

运行时按 lockfile 固定版本、哈希、ABI 和 SBOM，不依赖用户的系统 JDK/npm/pip 自动更新。核心、应用插件和角色资源分开分发，插件还有独立权限与许可。详见 'docs/distribution/runtime-policy.md' 与 'docs/distribution/plugin-ecosystem.md'。

## 许可

本仓库代码采用 [MIT](LICENSE)。第三方运行时、模型、插件和角色资源不因被调用而自动改授 MIT；请阅读 [NOTICE.md](NOTICE.md)。
