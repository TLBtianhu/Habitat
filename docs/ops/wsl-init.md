# WSL 身体：架构、安装清单、自愈与撤销

> 2026-10-31 建立，同日改为**管道版**（无监听端口、无轮询）。
> 所有改动可逆，撤销脚本见 §6。

## 1. 架构（现在是这个形状）

```
宿主 Windows
├─ 桥 bridge.mjs          监听 127.0.0.1:9224（等沙箱出站连入）+ 状态口 9225
│   └─ 监工 supervise-bridge.ps1：node 退出才重启（WaitForExit，不探活）
└─ 登录自启 FishbowlBoot.vbs → start-wsl.ps1 → 起监工 + 叫醒 WSL

WSL Ubuntu（systemd）
└─ fishbowl-body.service（Type=notify, WatchdogSec=30, Restart=always）
    └─ body.py
        ├─ Chrome headless：CDP 走 --remote-debugging-pipe（fd3/4），**不监听端口**
        ├─ 帧：Page.screencastFrame → 20fps 上限 → 出站 TCP 推给宿主
        ├─ 心跳：页面 setInterval → Runtime.addBinding → 10s 无心跳判卡死
        └─ 存活：宿主那条 TCP 连接本身；断开即"她掉线"
```

**关键变化**（相对第一版）：
- 没有 X server、没有 xdotool、没有 Xvfb；
- **WSL 内零监听端口**（实测 `ss -lnt` 无 9222/9223/9224）；
- 没有轮询：Chrome 死用 `waitpid` 感知，身体死由 systemd 重启，页面卡由**心跳缺失**判定（不是探针）。

## 2. 装了什么

| 位置 | 内容 |
|---|---|
| `/opt/habitat/fishbowl/body.py` | 身体（Chrome 管道 CDP + 出站链路 + 心跳 + sd_notify） |
| `/opt/habitat/runtime/chrome/` | Chrome for Testing 156 headless-shell（免 root 解包） |
| `/opt/habitat/runtime/deps/` | libnss3 / libnspr4 解包（补 3 个 .so） |
| `/etc/systemd/system/fishbowl-body.service` | `Type=notify` + `WatchdogSec=30` + `Restart=always` + 隐藏 Windows 盘 |
| `%APPDATA%\...\Startup\FishbowlBoot.vbs` | 登录自启（ONLOGON 计划任务需管理员，被拒后改走启动文件夹） |
| `tools/win/supervise-bridge.ps1` | 桥的监工（进程退出才重启） |

**没有装**：Xvfb、xdotool、系统 Chromium。

## 3. 隔离（实测）

服务单元里：

```ini
InaccessiblePaths=-/mnt/c
InaccessiblePaths=-/mnt/d
InaccessiblePaths=-/mnt/wslg
```

实测 `nsenter -t <主PID> -m -- ls /mnt/c` → **空**。

诚实边界：
- `/mnt` 下仍能看到 `c` `d` `wsl` `wslg` 四个名字（目录内容不可见）；
- 这是**故障边界**，不是信任边界——`wsl -u root` 无密码即可越界；
- 真要信任边界，得换独立用户/独立机器/真 VM。

## 4. 自愈链路（全部实测过）

| 故障 | 感知方式 | 恢复 | 实测 |
|---|---|---|---|
| Chrome 崩溃 | `waitpid`（SIGCHLD） | 0.5s 后重起 + 重挂页面 | 杀 Chrome 后 7s 内进程恢复、帧继续 |
| 页面卡死 | 心跳 10s 缺失 | 杀 Chrome → 同上 | 见 body.log `页面心跳超时` |
| 身体进程死 | systemd `Restart=always` | 3s 后重启 | 杀主进程后 `NRestarts=1`，8s 内帧恢复 |
| 桥死 | 监工 `WaitForExit` | 2s 后重启 | 停桥后监工拉起，身体自动重连（hellos+1） |
| 宿主断链 | TCP 关闭 | 身体指数退避重连（1→15s） | 实测重连成功 |
| WSL 停 | 下次登录/连接 | 登录自启 + systemd | —— |

## 5. 验证命令

```powershell
Invoke-RestMethod http://127.0.0.1:9225/status      # connected / frames / fps / hb
Invoke-WebRequest http://127.0.0.1:9225/frame -OutFile artifacts\latest.jpg
wsl -d Ubuntu -- systemctl status fishbowl-body --no-pager
wsl -d Ubuntu -- tail -30 /opt/habitat/fishbowl/body.log
wsl -d Ubuntu -- ss -lnt                            # 应为空（无监听）
Get-Content C:\Habitat\artifacts\boot.log -Tail 10
```

## 6. 撤销

```bash
wsl -d Ubuntu -u root -- bash -c "
  systemctl disable --now fishbowl-body.service
  rm -f /etc/systemd/system/fishbowl-body.service
  systemctl daemon-reload
  rm -rf /opt/habitat/fishbowl /opt/habitat/bin/body-up.sh
"
```

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\FishbowlBoot.vbs"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*bridge.mjs*' } | % { Stop-Process -Id $_.ProcessId -Force }
```

## 7. 安全说明

- 桥只绑 `127.0.0.1`；WSL 内不监听任何端口；
- Chrome 用 `--no-sandbox`（WSL 内核限制），**Chrome 自身沙箱是关的**，隔离靠 WSL 边界；
- CDP 能力 = 完全控制这个浏览器（读页面、执行 JS、下载）。管道只在服务进程内，不对外暴露；
- 若将来要让别的机器接入，必须加鉴权 + TLS。
