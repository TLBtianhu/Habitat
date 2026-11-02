# Windows / WSL 通信协议、授权与分发风险

> 2026-11-02 · 依据 Microsoft Learn 官方文档与 Habitat 当前实现。这里“协议”包括跨系统通信、文件互操作、进程互操作、网络和内部 Bearer/凭据协议。

## 1. 总体边界

- Windows 负责启动/停止 WSL、提供浏览器/控制台、保存安装包与用户入口；
- WSL2 是独立 Linux 内核环境，不是 Windows 进程的沙箱，也不是另一台可以被随便清空的专用机器；
- Habitat 的 owner/agent/capture token 是**应用授权**，与 Windows Administrator / WSL root 完全不同；
- 默认只使用 127.0.0.1、用户目录和本地 CPU；管理员/root 只用于明确列出的 provisioning 操作。

## 2. Windows ↔ WSL 通信与权限

| 机制 | 实际含义 | 需要授权/权限 | 我们的处理 |
|---|---|---|---|
| `wsl.exe <command>` | Windows 调起 Linux 命令；默认以发行版默认用户运行 | 普通调用无需管理员；`wsl -u root` 是 Linux root | 安装/运维脚本明确 `-d Ubuntu -u root`，日常不这样运行 Agent |
| Windows 调用 Linux 的权限继承 | Microsoft 文档说明这种方式还保留调用 Windows 进程的管理员权限 | 若从提权终端调用，Windows 侧也带提权上下文 | 不在提权终端做普通验收，避免“Windows admin + Linux root”双重权限 |
| Linux 调 Windows 程序（interop） | 可直接运行 `tool.exe`，且以活动 Windows 用户运行 | 通常无需管理员，但继承 Windows 用户权限 | 安装时固定 Linux node/npm 绝对路径，避免误调 Windows npm；可用 `[interop] appendWindowsPath=false` 收敛 |
| `WSLENV` | 指定 Windows/WSL 环境变量共享与路径转换 | 无管理员要求 | 只显式传需要的变量，不共享 token/模型路径/DSH_HOME |
| `/mnt/c`（DrvFs） | WSL 访问 Windows 文件 | 读写仍受 Windows 用户权限约束 | 只作为安装源/交换区，不作为运行时数据库、token 或模型目录 |
| `\\wsl$` / `\\wsl.localhost` | Windows 访问 Linux 文件 | 使用发行版默认用户权限 | 可用于诊断拷贝，不能把它当安全备份通道 |
| Linux 原生 ext4/VHDX | WSL 自己的文件系统与权限 | 标准 Linux UID/GID/ACL | 正式 app/data/config/outbox/pump/models 放这里 |
| `systemd` | 在 WSL 内管理服务 | `/etc/wsl.conf` 与系统单元需要 root | 仅 provisioning 使用 root，服务用普通/专用账号；**systemd 服务本身不保证 WSL 常驻** |
| keepalive | 让 WSL VM 不被空闲回收 | 普通用户即可 | 保留当前 Windows keepalive，但不把它当业务健康检查 |
| `.wslconfig` | Windows 用户全局 WSL2 配置，影响所有发行版 | 一般用户可改，影响面很大 | 不自动覆盖用户文件；如必须调整，展示 diff 并单独确认 |
| `/etc/wsl.conf` | 单个发行版配置：systemd、automount、interop、默认用户、boot | 修改需 root | 不把 `[boot] command` 当普通应用启动器，它默认 root 执行 |
| `wsl --shutdown` | 关闭所有运行中的 WSL2 发行版 | 普通用户也能执行，但影响全部工作 | 禁止作为日常停止/卸载/升级手段 |
| `wsl --terminate <distro>` | 立即终止一个发行版 | 不是正常服务停机 | 只在明确故障恢复时用，先尝试 systemctl 正常停止 |

## 3. 网络协议与需要的授权

### NAT（默认）

- WSL2 有独立虚拟 IP，重启后可能变化；
- 默认通过 localhost forwarding 从 Windows 访问 Linux 服务，不要硬编码 WSL IP；
- 从局域网访问不是默认能力，不能简单把 `0.0.0.0` 一绑就算完成；涉及 portproxy、Windows 防火墙、Hyper-V 防火墙和认证。

### Mirrored（Windows 11 22H2+）

- 在 `%UserProfile%\.wslconfig` 的 `[wsl2]` 设置 `networkingMode=mirrored`；
- 可改善 localhost、IPv6、VPN、组播和 LAN 兼容性；
- 它不是默认环境，也不应由安装器静默开启；配置变化需要 WSL 完整重启。

### Hyper-V / Windows 防火墙

- 新环境可能默认启用 Hyper-V Firewall；
- `LoopbackEnabled` 默认允许 Windows↔WSL loopback，但企业策略可覆盖；
- 远程/LAN 访问要单独授权和最小端口规则，不能关闭整个防火墙或把默认入站全部 Allow；
- 本地 9230–9272 等端口大于 1024，**监听本身不需要管理员/root**，但防火墙/远程暴露是另一件事。

## 4. Habitat 当前协议与授权表

| 通道/端口 | 协议与用途 | 授权 | 默认暴露与注意 |
|---|---|---|---|
| `9230` | Stage HTTP：控制台 UI、状态、本地 HLS 入口 | 控制操作转交 Control，不把静态 UI 当授权边界 | 仅 127.0.0.1；HLS 当前无活动流时明确无 feed |
| `9240` | Control HTTP：任务、批准、system.chat、pump/status | `owner.token` 管理/主人聊天/导出；`agent.token` 供 Agent 写系统消息 | 仅 127.0.0.1；远程开放前必须统一读保护和 TLS |
| `9260` | Desktop HTTP：AppSession 投影、CaptureSession、shot/frames | Agent/Owner 创建会话；每次捕获独立短期 token、revision、expiresAt | 仅 127.0.0.1；捕获 token 与 agent token 不等价 |
| `9270` | Voice HTTP：VoiceProfile、sample、utterance、WAV | Agent 调 `/speak`；主人管理样本/默认音色 | 仅 127.0.0.1；正式音色与通用测试音色分开 |
| `9271` | Audio Mixer：48kHz stereo PCM | 当前没有独立 Bearer，依赖 loopback 隔离 | 不得直接暴露到 LAN/公网 |
| `9272` | Outlet Supervisor：HLS/RTMP 子进程 start/stop/status | Owner/Agent Bearer；RTMP stream key 仅主人配置，配置 600 | 仅 127.0.0.1；start accepted 不等于成功，stop 等真实退出 |
| `25600/rpc` | mcpfabric JSON-RPC：MC 文字 obs 与闭集动作 | 独立 mcpfabric token | 仅 127.0.0.1；不得使用发行包内硬编码 token |
| `25565` | Minecraft 游戏协议 | 世界/账号身份，非 Habitat owner | 默认本地；RCON 若启用另用独立密码且仅本地 |
| `3003` | NapCat OneBot HTTP | 本机受保护 access token | 已登录并验证 `/get_login_info` |
| `3002` | NapCat WS | 本机受保护 access token | 真实 WS ready；默认只读，指定群 addressed 可回复 |
| B站 HTTPS + WSS | WBI 签名、DanmuInfo、弹幕事件 | 用户提供 cookie/SESSDATA | 只读连接；不需要管理员；不自动公开推流 |
| RTMP/RTMPS | 可选视频出口 | streamKey + 主人显式配置 | 默认不启用；不得把 key 写日志或安装包 |
| OBS `4455` | OBS WebSocket | OBS 密码 | 仅本机，不能无密码开放 |
| CDP `9222` | Chrome DevTools 调试 | 浏览器调试能力 | 开发/测试用，稳定版默认关闭 |
| `9224/9225` | 旧 Fishbowl TCP/HTTP 桥，含 eval/click 等控制 | 旧实现没有完整 Bearer | **开发遗留，不能作为发行面默认启动** |
| 旧 Display | 无鉴权像素/控制服务 | 已拒绝启动 | 不得重新用于发行 |

补充：mcpfabric token 已迁移到独立的 `/etc/habitat/mcpfabric.token`（mode 600），源码不再带开发 token 回退；未配置会明确失败。旧 9224/9225 桥也已默认拒绝启动。

## 5. 哪些操作真正需要管理员/root

| 操作 | Windows Administrator | WSL root | Habitat owner | 说明 |
|---|---:|---:|---:|---|
| 首次启用 VirtualMachinePlatform/WSL 组件 | 需要，可能重启 | — | 知情确认 | 离线镜像也必须单独完成 |
| 安装 GPU/芯片组驱动 | 需要，按厂商包 | — | 知情确认 | 可选，CPU 路径不能依赖它 |
| 写 `%ProgramFiles%`/系统目录、HKLM | 通常需要 | — | — | 默认不走此路径 |
| 创建 Windows 服务 | 需要 `SC_MANAGER_CREATE_SERVICE` 等权限 | — | — | 默认不注册全机服务 |
| 改 Hyper-V/Windows 防火墙 | 通常需要管理员或企业策略 | — | 明确确认 | 只对远程访问单独做 |
| 安装 WSL 发行版/用户级应用 | 通常不需要全局管理员 | 视具体包 | — | 仍受组织策略/Store 限制 |
| `/etc/wsl.conf`、systemd 系统单元 | — | 需要 | 知情确认 | 一次性 provisioning |
| 写 `/opt /etc /var` 的 Habitat 目录 | — | 需要，或预先授权目录 owner | — | 安装后必须归实际服务账号所有 |
| 日常 Agent/Desktop/Voice/Outlet | 不需要 | 不需要 | 按 scope | 端口均大于 1024 |
| 模型/运行时下载 | 不需要 | 不需要 | 网络与磁盘确认 | 校验来源/SHA256/大小 |
| B站/QQ 第三方账号操作 | 不需要 | 不需要 | 用户提供账号凭据与明确授权 | 不代替平台授权，不绕过验证码/风控 |
| 公开推流/远程观看 | 可能需要防火墙变更 | 不需要 | **必须明确开启** | 默认关闭 |
| `wsl --shutdown`/清空数据/卸载 purge | 不需要管理员但高破坏 | 可能需要 | 必须另行确认 | 不与普通停止/升级混用 |

## 6. 开发与分发最容易踩的坑

1. **Windows npm 被 WSL interop 误调**：已经实际遇到，导致 UNC 路径 EPERM。固定 Linux node/npm 路径和 PATH。
2. **root 创建目录，普通 Agent 写不进去**：已经实际遇到 outbox EACCES。安装时设置 owner，并用真实服务账号验收。
3. **`%ProgramData%` 默认导致管理员问题**：改为 `%LOCALAPPDATA%` 默认，系统安装另列选项。
4. **`/mnt/c` 权限不是 Linux chmod**：Windows ACL 仍主导；metadata 未启用时不要假设 mode600 会按预期保存。秘密放 Linux ext4。
5. **`\\wsl$` 使用默认用户**：从 Windows 修改文件后，Linux 侧 owner/权限可能和预期不同，不能拿它替代安装器的所有权设置。
6. **CRLF、BOM、中文路径、空格**：Bash 出现 `$'\r'`、路径拆分、参数插值错误。脚本统一 UTF-8 no BOM + LF，路径全部引用，避免把 Windows 文本直接拼进 bash。
7. **Python venv symlink 被 zip 弄坏**：`python/bin/python` 常是指向系统解释器的 symlink。不要简单 zip 便携环境；在目标机重建或保留链接。
8. **模型/Profile 绝对路径写死**：`/opt/habitat`、模型 cache、DSH_HOME、AGENTS_HOME 必须按安装用户生成，不能照抄开发机。
9. **systemd 服务不代表 WSL 常驻**：需要 keepalive；健康检查要看连接/心跳，不是只看 `systemctl is-active`。
10. **修改 `.wslconfig` 影响所有发行版**：不能为了 Habitat 全局改 mirrored/memory/GPU 而不提示；`wsl --shutdown` 也会停别人的工作。
11. **NAT IP 变化与端口冲突**：不要硬编码 WSL IP；Windows/WSL 的 localhost forwarding 可能撞端口，先确认监听者身份。
12. **代理污染本地调用**：`HTTP_PROXY` 会让 127.0.0.1 请求失败；本地测试强制 bypass，外部下载才走代理。
13. **“端口能连”不等于“协议健康”**：必须检查 `/status`、token scope、心跳、事件水位，不能只看 TCP。
14. **旧开发面混入发行包**：`dist/package` 旧副本、9224/9225 无鉴权桥、旧 Display、测试 token 都要排除，发行包必须重新构建。
15. **升级时 `rm -rf app` 且服务仍在运行**：会造成半新半旧/数据丢失；必须 staging、校验、停服务、原子切换、回滚。
16. **大型模型和 VHDX 膨胀**：应用、运行时、模型、日志分层；日志轮转，不在升级/卸载时自动 compact VHDX。
17. **SmartScreen/签名/执行策略**：签名安装包和 EXE，提供哈希；不要要求用户关闭 SmartScreen 或全局修改执行策略。
18. **把 MSIX 当普通沙箱**：WSL/服务/进程编排不是普通 UWP 沙箱能力，若用 MSIX 需要明确 full-trust 与相关 capability/商店限制，不能默认承诺商店分发。
19. **第三方账号权限 ≠ 系统授权**：SESSDATA、NapCat token、RTMP key 是不同秘密，不能共享 owner token，更不能打进安装包。
20. **卸载误伤其他 WSL 工作**：默认只停 Habitat 单元，保留数据；不自动 `wsl --shutdown`、不删模型/配置/聊天/outbox。

## 7. 推荐分发流程

1. **Preflight（普通用户）**：Windows/WSL 版本、虚拟化、发行版、磁盘、端口、代理、已有 DSH 隔离检查；只报告，不修改。
2. **一次性 provisioning（显式授权）**：只启用必要组件、创建专用服务账号/目录、安装 systemd 单元；每步可回滚。
3. **应用安装（普通用户/专用目录）**：staging 解包、哈希与安全路径检查、所有权检查、依赖安装。
4. **启动验收（真实运行账号）**：端口协议、token scope、outbox/pump 写入、控制台文字对话、按需捕获和停止全部通过。
5. **升级**：保留 data/config/models/outbox/pump/tasks/chat，健康失败自动回滚应用层。
6. **卸载**：默认只停 Habitat 单元并保留数据；清 VM、清模型、清用户数据分别单独确认。

## 官方参考

- [Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install)
- [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [WSL file systems and interop](https://learn.microsoft.com/en-us/windows/wsl/filesystems)
- [WSL file permissions](https://learn.microsoft.com/en-us/windows/wsl/file-permissions)
- [WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- [systemd on WSL](https://learn.microsoft.com/en-us/windows/wsl/systemd)
- [WSL GPU compute](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gpu-compute)
- [Hyper-V Firewall](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/hyper-v-firewall)
- [CreateServiceW / service access rights](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-createservicew)
- [Windows Known Folders](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)
- [App capability declarations](https://learn.microsoft.com/en-us/windows/uwp/packaging/app-capability-declarations)
