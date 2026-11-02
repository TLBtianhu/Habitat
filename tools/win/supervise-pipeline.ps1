# 流水线的监工：进程退出才重启（事件驱动，不探活）
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\Habitat\artifacts\pipeline.log'
$err = 'C:\Habitat\artifacts\pipeline.err'
$dir = 'C:\Habitat\tools'

while ($true) {
  $started = Get-Date
  $p = Start-Process -FilePath node -ArgumentList 'pipeline.mjs' -WorkingDirectory $dir -NoNewWindow -PassThru `
       -RedirectStandardOutput $log -RedirectStandardError $err
  $p.WaitForExit()
  $ran = ((Get-Date) - $started).TotalSeconds
  if ($ran -lt 5) { Start-Sleep -Seconds 10 } else { Start-Sleep -Seconds 2 }
}
