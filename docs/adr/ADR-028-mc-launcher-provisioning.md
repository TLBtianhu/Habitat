# ADR-028: mc-launcher 世界 provisioning 与运行时发行

日期：2026-11-03
状态：Accepted（本地真实验收通过；公开运行时发布与生产签名仍待完成）

## 背景

`mc-launcher` 和 `mc` 是两个同级应用，不是主从 AgentLoop：

- `mc-launcher` 负责世界 provisioning、Java 进程、升级前准备、停止和备份。
- `mc` 负责游戏内观察、行动、社交记忆和游戏行为。
- 两者由同一个 Dafeiyu 人格与当前 Episode 驱动，但不复制彼此的社交记忆。

启动器不能把“下载了 JAR”或“端口打开”报告为可玩的世界。只有真实世界、AI 客户端和 mcpfabric RPC 观测都成功，才进入 `READY`。

## 决策

### 1. 同一 Episode，不同职责

`run-continuous.mjs` 将同一个 `episode` 和 `episodeStore` 注入 launcher 与 MC provider。Launcher 只写入 provisioning phase、当前任务和参与者，不读取或写入 MC 私域社交记忆。`mc-launcher.local` 与 `mc.world.current` 是同一 Episode 的参与者，不是两个独立人格。

### 2. 明确的启动顺序与就绪门槛

1. 校验或下载 Adoptium JDK25，使用固定 SHA256。
2. 准备最小 MC 客户端程序包。
3. 准备 Vanilla 1.21.4 世界、EULA、回环绑定和 RCON。
4. 启动世界 Java 进程并等待游戏端口。
5. 准备 HeadlessMC 的 vanilla/Fabric 版本和版本专属 `fabric-1.21.4` 游戏目录。
6. 启动 AI 客户端，等待真实 mcpfabric RPC 的玩家与场景观测。
7. 只有全部成功才保存 `READY` Episode 状态。

HeadlessMC 的 `hmc.mcdir`/`user.home`、XDG 数据目录和受管 Java 路径都固定在实例目录内。当前版本默认 `game-for-each-version`，因此 mods 和 `mcpfabric.config.json` 必须写入实际 `fabric-1.21.4` 游戏目录，不能只写客户端根目录。

首次资源下载可能很慢，启动超时可配置；下载中不伪报 RPC ready。`no_client_player` 是客户端加入世界的暂态，已有客户端应继续等待，而不是被杀掉重启。

Registry 的 `mc-launcher.provision` 工具超时上限为 120 秒。超时返回的是 `accepted`/timeout，不是 ready；provider 可能继续完成 provisioning，调用方必须读取 `mc-launcher.status` 和 Episode 状态确认最终结果，不能把 accepted 当成世界已启动。

### 3. 进程所有权与幂等

- 启动器记录已验证 PID，并在同一 runtime 内优先复用它。
- 进程扫描只用于恢复和清理；HeadlessMC 启动器与 `KnotClient` 游戏子进程是同一进程组，不算两个客户端。
- 停止时先停止 AI 客户端，再停止世界；对实例目录验证过的进程组发信号，绝不使用全局 `pkill` 或 `wsl --shutdown`。
- 旧进程、token 或配置不匹配时可以替换；加入世界中的 `no_client_player` 不触发替换。
- 备份只包含世界数据与配置，不包含 token、账号、运行时缓存或日志。

### 4. 最小可分发运行时

`tools/build-mc-client-runtime.mjs` 只收集：

- `headlessmc.jar`、`headlessmc-lwjgl.jar`、`fabric-installer.jar`；
- `mods/mcpfabric.jar`、`mods/fabric-api.jar`；
- 对应 MIT/Apache-2.0 许可证和 `THIRD-PARTY-NOTICES.md`；
- 带文件 SHA256 的 `runtime-manifest.json`。

不包含完整 `mc-native` 目录、Minecraft assets/libraries、版本缓存、存档、账号、token、日志或开发配置。Minecraft 资源和库仍从官方来源按需取得。

`runtime/mc-client-lock.json` 与 `runtime/mc-client-sbom.json` 记录真实构建的版本和哈希，当前 `distribution=built-not-published`。下载分支必须验证 SHA256、安全解压并通过白名单测试；不能用本机模板路径代替发行包测试。

## 验证

- `node adapters/mc-launcher/verify-provider.mjs`：Episode、幂等、停止顺序、无凭证备份。
- `node adapters/mc-launcher/verify-runtime-package.mjs`：归档白名单、哈希、许可证和下载安装分支。
- `node tools/verify-mc-client-lock.mjs`：运行时锁与 CycloneDX SBOM。
- `node tools/verify-mc-launcher-live.mjs`：真实 Java 世界、AI 客户端、mcpfabric RPC 观测、幂等停止和世界备份，已通过当前 WSL 验收。
- CI 运行前三项；真实 Java 验收需要本机 Java、网络和资源，不伪造成 CI 的快速单元测试。

## 尚未完成

- 将 `mc-client-runtime-v0.1.0` 归档发布到锁中记录的 Release，并进行真实公网下载验收。
- 世界备份恢复、升级回滚和撤销流程。
- Windows-hosted MC 房间的真实验收。
- 生产 Authenticode 签名仍按既有决定延期；本 ADR 不宣称签名已完成。
