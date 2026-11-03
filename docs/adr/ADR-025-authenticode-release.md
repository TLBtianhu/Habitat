# ADR-025：单文件安装包与 Authenticode 发布验收

> 2026-11-03 · 签名结构测试与受信任生产签名是两条不同路径，不能混称。

## 决定

- `HabitatSetup.exe` 嵌入应用包、runtime lock/SBOM、安装脚本和 `HabitatConsole.exe`，可以单独下载运行；
- 嵌入内容只在安装时解压到临时目录，安装结束删除；正式程序、data/config 不写入构建中间物；
- 使用微软官方 `Microsoft.Windows.SDK.BuildTools`，固定版本并校验 NuGet SHA512，不安装系统 SDK；
- `sign-release.ps1` 支持现有证书 thumbprint 或 PFX；PFX 密码不进入命令行，导入证书用后删除；
- 签名后重新生成 SHA256SUMS，并分别验证签名结构、证书链和 RFC3161 时间戳；
- 普通 CI 只用短期自签名证书测试签名结构，明确不声明生产信任；
- 手动 `sign-release` 工作流必须提供生产 PFX secrets，`Get-AuthenticodeSignature.Status=Valid` 才能发布；
- 正式发布只提供单文件 Setup、Console 和哈希清单，不要求用户同时下载 payload 目录。

## 实际验收

- 单独复制 `HabitatSetup.exe` 到空目录后，完整安装、升级回滚和卸载均通过；
- 自签名测试验证了 Authenticode 结构、时间戳和签名后哈希，测试证书已删除；
- 没有生产证书时工作流明确失败，不生成伪称受信任的发行包。

## 当前边界

- 当前仓库尚未配置生产代码签名证书 secrets，因此尚不能声称已有受信任签名发行版；
- 代码签名只证明发布者身份与文件未被篡改，不替代插件索引、runtime lock 和撤销机制。
