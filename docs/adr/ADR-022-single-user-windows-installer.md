# ADR-022：单用户安装版与真实 Windows EXE

> 2026-11-03 · Windows 只保留安装包与控制台客户端两个 EXE，默认单用户、免管理员。

## 实现

- `HabitatSetup.exe`：只调用受控安装脚本，安装/升级/回滚/卸载；
- `HabitatConsole.exe`：打开现有 Windows 客户端，不承载 AgentLoop 或推流；
- 应用安装在 WSL 当前用户的独立实例目录，开发 `/opt/habitat`、便携版与安装版互不覆盖；WSL 默认 root 时仅首次创建非 root `habitat` 用户，后续安装命令全部使用该用户；
- staging → 必需文件校验 → 原子替换，失败恢复旧 app/runtime；
- 从 `runtime/lock.json` 读取固定源与哈希，先引导 Node，再执行完整 lock/SBOM/组件校验；0.1.1 通过 GitHub Releases 分发，包含 31 个 Chrome 共享库；
- 已验证 runtime 归档可复用，升级不静默替换为系统 Node/JDK/npm/pip；
- 当前用户注册表、卸载入口、`habitat://` 协议与开始菜单快捷方式；
- 卸载只移除 app/runtime、客户端文件和注册信息，保留 data/config、记忆、模型和用户数据。

## 实际验收

- 真实 `HabitatSetup.exe` 安装、注册、回滚、卸载通过；
- 真实 Node/JDK/Chrome/runtime lock 与 SBOM 校验通过；
- 模拟升级失败恢复旧应用；
- 卸载后 data/config 保留，app/runtime、协议、卸载入口和快捷方式清理；
- `HabitatConsole.exe` 与安装器载荷均通过 MZ/SHA256 检查。

## 当前边界

- 当前 EXE 是测试构建，**未进行 Authenticode 签名**，SHA256 只证明本次构建内容一致，不替代发布签名；
- WSL 已安装是前提；不静默修改全局 WSL 配置或防火墙；
- 安装不自动启动 HLS/RTMP，也不自动公开推流；
- 生产发布仍需接入签名证书、撤销与更新通道。
