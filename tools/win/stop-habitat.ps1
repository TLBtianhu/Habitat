# Habitat Windows 正常停机：先优雅停服务，再退出 WSL；失败时不强关 VM。
$ErrorActionPreference = 'Stop'
$log = 'C:\Habitat\artifacts\boot.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"$(Get-Date -Format s) stop: begin graceful Habitat shutdown" | Out-File -Append -Encoding utf8 $log

wsl -d Ubuntu -u root -- bash /opt/habitat/app/tools/wsl-stop.sh
if ($LASTEXITCODE -ne 0) {
  "$(Get-Date -Format s) stop: service shutdown failed; VM left running" | Out-File -Append -Encoding utf8 $log
  throw 'Habitat 服务未能全部正常停止，已取消 wsl --shutdown，请先检查失败单元。'
}

# 只停止薄启动器创建的 keepalive，不碰其他 Windows/DSH 进程。
$keepalive = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*sleep infinity*' }
foreach ($p in $keepalive) {
  Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
}

# 注意：调用前请保存其他 WSL 工作；这会关闭整个 Ubuntu VM。
wsl --shutdown
if ($LASTEXITCODE -ne 0) { throw 'wsl --shutdown failed' }
"$(Get-Date -Format s) stop: completed" | Out-File -Append -Encoding utf8 $log
