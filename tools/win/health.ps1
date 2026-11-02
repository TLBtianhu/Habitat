# 看门狗：探活靠桥的 /status；不健康就让 provider 重启（不直接调 wsl）
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\Habitat\artifacts\health.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

# keepalive：叫一下 Worker（provider 内部处理）
node "C:\Habitat\tools\provider.mjs" wake *>> $log

$ok = $false
try {
  $s = Invoke-RestMethod -Uri 'http://127.0.0.1:9225/status' -TimeoutSec 5
  if ($s.body) { $ok = $true }
} catch { }

if (-not $ok) {
  "$(Get-Date -Format s) body down -> provider restart" | Out-File -Append -Encoding utf8 $log
  node "C:\Habitat\tools\provider.mjs" restart body *>> $log
  Start-Sleep -Seconds 6
  try {
    $s2 = Invoke-RestMethod -Uri 'http://127.0.0.1:9225/status' -TimeoutSec 6
    "$(Get-Date -Format s) restart -> body=$($s2.body)" | Out-File -Append -Encoding utf8 $log
  } catch {
    "$(Get-Date -Format s) restart FAIL" | Out-File -Append -Encoding utf8 $log
  }
}
