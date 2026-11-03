# Habitat Windows 生命周期：固定命令白名单，不执行用户输入的任意 WSL 命令。
$script:HabitatDistro = 'Ubuntu'

function Get-HabitatNodePath {
  param([scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command })
  $execStart = & $Wsl 'systemctl show habitat-agent -p ExecStart --value'
  if ($execStart -notmatch '(/[^\s;]+/node)\b') { throw 'Cannot resolve Habitat Node runtime from ExecStart' }
  return $Matches[1]
}

function Invoke-WslNative {
  param([string]$Command)
  $output = & wsl.exe -d $script:HabitatDistro -u root -- bash -lc $Command 2>&1
  if ($LASTEXITCODE -ne 0) { throw "WSL command failed: $output" }
  return $output
}

function Invoke-ControlHttp {
  param([string]$Method, [string]$Path, [string]$Token = $null)
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $params = @{
    Method = $Method
    Uri = "http://127.0.0.1:9240$Path"
    Headers = $headers
    TimeoutSec = 6
  }
  if ($Method -eq 'POST') {
    $params.ContentType = 'application/json'
    $params.Body = '{}'
  }
  return Invoke-RestMethod @params
}

function Wait-HabitatHealth {
  $checks = @(
    'http://127.0.0.1:9240/status',
    'http://127.0.0.1:9260/status',
    'http://127.0.0.1:9270/health',
    'http://127.0.0.1:9271/status',
    'http://127.0.0.1:9272/status'
  )
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    $failed = @()
    foreach ($url in $checks) {
      try { $null = Invoke-RestMethod -Uri $url -TimeoutSec 3 } catch { $failed += $url }
    }
    if ($failed.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 800
  }
  throw 'Habitat health check timed out'
}

function Start-HabitatWsl {
  param(
    [scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command },
    [scriptblock]$ProcessStarter = {
      param($Distro)
      Start-Process wsl.exe -ArgumentList '-d', $Distro, '--', 'sleep', 'infinity' -WindowStyle Hidden -PassThru
    },
    [string]$Distro = 'Ubuntu'
  )
  $script:HabitatDistro = $Distro
  try {
    & $Wsl 'true' | Out-Null
    return $null
  } catch {
    $process = & $ProcessStarter $Distro
    Start-Sleep -Seconds 2
    & $Wsl 'true' | Out-Null
    return $process
  }
}

function Start-HabitatLifecycle {
  param(
    [scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command },
    [scriptblock]$Http = { param($Method, $Path, $Token) Invoke-ControlHttp $Method $Path $Token },
    [scriptblock]$Health = { Wait-HabitatHealth },
    [scriptblock]$ProcessStarter = {
      param($Distro)
      Start-Process wsl.exe -ArgumentList '-d', $Distro, '--', 'sleep', 'infinity' -WindowStyle Hidden -PassThru
    },
    [string]$Distro = 'Ubuntu'
  )
  $script:HabitatDistro = $Distro
  $keepalive = Start-HabitatWsl -Wsl $Wsl -ProcessStarter $ProcessStarter -Distro $Distro
  $node = Get-HabitatNodePath -Wsl $Wsl
  & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs boot" | Out-Null
  & $Wsl 'bash /opt/habitat/app/tools/wsl-start-adapters.sh' | Out-Null
  & $Wsl 'systemctl start habitat-stage.service habitat-control.service habitat-desktop.service habitat-voice.service habitat-audio.service habitat-outlet-supervisor.service habitat-agent.service' | Out-Null
  & $Health | Out-Null
  & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs ready" | Out-Null
  $status = & $Http 'GET' '/lifecycle' $null
  return @{ status = $status; keepaliveProcess = $keepalive }
}

function Stop-HabitatLifecycle {
  param(
    [scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command },
    [string]$Distro = 'Ubuntu'
  )
  $script:HabitatDistro = $Distro
  $node = Get-HabitatNodePath -Wsl $Wsl
  & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs stopping" | Out-Null
  & $Wsl 'bash /opt/habitat/app/tools/wsl-stop.sh' | Out-Null
  & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs stopped" | Out-Null
  return @{ state = 'stopped'; wslShutdown = $false }
}

function Get-HabitatLifecycleStatus {
  param(
    [scriptblock]$Http = { param($Method, $Path, $Token) Invoke-ControlHttp $Method $Path $Token }
  )
  return & $Http 'GET' '/lifecycle' $null
}

function Invoke-HabitatRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Token,
    [scriptblock]$Http = { param($Method, $Path, $Token) Invoke-ControlHttp $Method $Path $Token }
  )
  if ([string]::IsNullOrWhiteSpace($Token)) { throw 'owner token required' }
  return & $Http 'POST' '/recovery' $Token
}

Export-ModuleMember -Function Start-HabitatLifecycle, Stop-HabitatLifecycle, Get-HabitatLifecycleStatus, Invoke-HabitatRecovery, Start-HabitatWsl
