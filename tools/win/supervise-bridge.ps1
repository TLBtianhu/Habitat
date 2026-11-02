# 桥的监工：进程退出才重启（事件驱动，不探活）
$ErrorActionPreference = 'SilentlyContinue'
$bridge = 'C:\Habitat\tools\bridge.mjs'
$log = 'C:\Habitat\artifacts\bridge.log'
$err = 'C:\Habitat\artifacts\bridge.err'

while ($true) {
  $started = Get-Date
  $p = Start-Process -FilePath node -ArgumentList "`"$bridge`"" -NoNewWindow -PassThru `
       -RedirectStandardOutput $log -RedirectStandardError $err
  $p.WaitForExit()
  $ran = ((Get-Date) - $started).TotalSeconds
  if ($ran -lt 3) {
    # 很可能是端口已被另一个实例占用：退避，避免热循环
    Start-Sleep -Seconds 15
  } else {
    Start-Sleep -Seconds 2
  }
}
