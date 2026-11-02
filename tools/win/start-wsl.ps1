# Habitat 薄启动器：只负责 WSL keepalive 与核心服务，不在 Windows 起运行时组件
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\Habitat\artifacts\boot.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"$(Get-Date -Format s) boot: start" | Out-File -Append -Encoding utf8 $log

# 常驻 WSL keepalive：防止 WSL 空闲回收虚拟机，导致端口与服务一起消失
$keepalive = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*sleep infinity*' }
if (-not $keepalive) {
  Start-Process wsl.exe -ArgumentList '-d','Ubuntu','--','sleep','infinity' -WindowStyle Hidden
  "$(Get-Date -Format s) boot: wsl keepalive started" | Out-File -Append -Encoding utf8 $log
}

# 核心服务常驻；Outlet 不在开机时启动，只有真正开播才生产像素。
wsl -d Ubuntu -u root -- systemctl start habitat-stage.service habitat-control.service habitat-desktop.service habitat-voice.service habitat-audio.service habitat-outlet-supervisor.service habitat-agent.service *>> $log

"$(Get-Date -Format s) boot: done" | Out-File -Append -Encoding utf8 $log
