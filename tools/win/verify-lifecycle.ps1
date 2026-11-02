# Windows 生命周期离线验收：不依赖真实 WSL 或网络。
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force

$script:commands = @()
$script:failStop = $false
$script:firstProbe = $true
$wsl = {
  param($Command)
  $script:commands += $Command
  if ($Command -eq 'systemctl show habitat-agent -p ExecStart --value') { return '/home/test/node agent/run-continuous.mjs' }
  if ($Command -eq 'true' -and $script:firstProbe) {
    $script:firstProbe = $false
    throw 'WSL not running'
  }
  if ($Command -eq 'bash /opt/habitat/app/tools/wsl-stop.sh' -and $script:failStop) { throw 'simulated stop failure' }
  return 'ok'
}
$processStarter = { param($Distro) return [pscustomobject]@{ Id = 4242; HasExited = $false } }
$health = { return $true }
$script:recoveryCalls = @()
$http = {
  param($Method, $Path, $Token)
  if ($Method -eq 'POST') {
    $script:recoveryCalls += @{ Path = $Path; Token = $Token }
    return [pscustomobject]@{ state = 'running'; recoveryRequired = $false; pendingWrites = @{} }
  }
  return [pscustomobject]@{ state = 'running'; recoveryRequired = $true; bootId = 2; lastShutdownAbnormal = $true }
}

$started = Start-HabitatLifecycle -Wsl $wsl -Http $http -Health $health -ProcessStarter $processStarter
if ($started.keepaliveProcess.Id -ne 4242) { throw 'WSL down 时必须创建受控 keepalive' }
if ($started.status.recoveryRequired -ne $true) { throw '异常状态必须显示需要恢复' }
if ($script:commands -contains 'wsl --shutdown') { throw '启动流程不得关闭整个 WSL' }

$stopped = Stop-HabitatLifecycle -Wsl $wsl
if ($stopped.state -ne 'stopped' -or $stopped.wslShutdown) { throw '停止必须是优雅停止且不得全局关闭 WSL' }
if ($script:commands -contains 'wsl --shutdown') { throw '停止流程不得执行 wsl --shutdown' }

$script:failStop = $true
$before = $script:commands.Count
$failed = $false
try { Stop-HabitatLifecycle -Wsl $wsl } catch { $failed = $true }
if (-not $failed) { throw '停止失败必须显式报错' }
$failedCommands = $script:commands[$before..($script:commands.Count - 1)]
if ($failedCommands -contains 'node /opt/habitat/app/tools/lifecycle.mjs stopped') { throw '停止失败后不得写入 stopped 成功状态' }

$recovered = Invoke-HabitatRecovery -Token 'owner-test' -Http $http
if ($recovered.recoveryRequired) { throw '恢复完成后不得继续显示需要恢复' }
if ($script:recoveryCalls.Count -ne 1 -or $script:recoveryCalls[0].Path -ne '/recovery' -or $script:recoveryCalls[0].Token -ne 'owner-test') {
  throw '恢复必须通过 owner token 调用 /recovery'
}
$status = Get-HabitatLifecycleStatus -Http $http
if ($status.state -ne 'running' -or -not $status.recoveryRequired) { throw '异常状态读取失败' }
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'client.ps1'), [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw "client.ps1 语法错误: $($parseErrors[0].Message)" }
Write-Output 'ok: Windows 客户端 WSL 检测、启停、失败不伪报、异常恢复与禁止全局关机'
