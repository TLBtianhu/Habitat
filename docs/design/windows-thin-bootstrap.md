# Windows 只是引导器，不是运行时

> 2026-10-31 · 目标：**Habitat 的运行时全部在 WSL/Unix 环境里，Windows 只承担三个薄入口。**

## 1. Windows 只允许做三件事

| 入口 | 作用 | 不允许做什么 |
|---|---|---|
| **安装包 EXE** | 把 Habitat 安装到 WSL：`/opt/habitat/app`、`/etc/habitat`、`/var/lib/habitat` | 不在 Windows ProgramData/注册表运行时目录里放系统本体 |
| **启动/关闭 EXE** | 启动、停止、查看 WSL 里的服务 | 不承载 AgentLoop、客户端、显示器、Outlet |
| **身份绑定辅助** | 展示扫码/设备码页面，方便用户授权 | 授权完成后，凭证进入 WSL 的 Identity Hub；Windows 不长期保管 |

除此之外，**没有第四个 Windows 组件**。

## 2. 全部在 WSL 的东西

- AgentLoop / DSH；
- AI 客户端：QQ、MC、live、IDE、browser、terminal；
- Display Server 与 Outlet；
- 技能、知识库、配置、缓存、日志、世界存档；
- Identity Hub 与凭证库（加密）。

## 3. 当前尚未完成的迁移

现有实现里仍在 Windows 的部分，都是**过渡形态**：

| 当前在 Windows | 目标 |
|---|---|
| `bridge.mjs` | 移到 WSL，成为 Unix 内部总线 |
| `pipeline.mjs` / HLS Outlet | 移到 WSL，ffmpeg 原生输出 |
| `bot-host/camera.js` | 移到 WSL，或变成 Display Server 的渲染后端 |
| `C:\ProgramData\Habitat` | 只是打包测试，不是最终安装位置 |

## 4. 为什么必须这样

- **可移植**：macOS、Android/Termux 都是类 Unix，迁移的是同一套运行时；
- **可测试**：开发态/用户态都在 WSL，路径与权限模型一致；
- **可维护**：Windows 只剩安装器、启动器、授权辅助，出了问题不会蔓延到系统本体；
- **可分发**：安装包 EXE 只是引导器，真正的系统是 WSL 里的自包含环境。

## 5. 一句话

> **Windows 负责"把她带到这台机器上"，之后她的一切都在 WSL 里。**
