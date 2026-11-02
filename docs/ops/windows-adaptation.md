# Windows 适配与 WSL 前提

## WSL 是不是自带？

- Windows 10（1607+）与 Windows 11 都提供 WSL；
- **WSL2 在 Home / Pro 都可用**；
- 但它是**可选功能**：有些机器已启用，有些需要安装/开启；
- 通常需要管理员权限、开启虚拟化，有时需要重启。

所以安装器不能假设“用户已有 WSL”。

## 安装器应该做什么

1. **检测**：`wsl -l -v` 是否存在可用发行版；
2. **引导安装**：没有则尝试 `wsl --install`（说明需要管理员与可能重启）；
3. **导入环境**：没有现成 Ubuntu 时，导入打包的 rootfs；
4. **兜底**：无法启用 WSL 时，明确提示并给出**服务器部署/原生 Linux 部署**选项，而不是假装能装。

## 跨平台的好处

Habitat 的本体是 Unix 运行时：

- Windows 上：WSL 只是引导器；
- Linux 服务器上：原生运行；
- macOS / Android（类 Unix）上：可复用大部分客户端与 Display/Outlet。

**Windows 适配要做的是“引导与授权”，不是把系统写死在 Windows 上。**
