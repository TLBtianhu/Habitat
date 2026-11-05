# Habitat Windows 生命周期：固定命令白名单，不执行用户输入的任意 WSL 命令。
$script:HabitatDistro = 'Ubuntu'
$script:HabitatWslUser = 'root'
$script:HabitatControlBaseUrl = 'http://127.0.0.1:9240'
$script:HabitatHealthUrls = @(
  'http://127.0.0.1:9240/status',
  'http://127.0.0.1:9260/status',
  'http://127.0.0.1:9270/health',
  'http://127.0.0.1:9271/status',
  'http://127.0.0.1:9272/status'
)

function Set-HabitatInstance {
  param([string]$InstallRoot = '')
  if (-not $InstallRoot) {
    $script:HabitatWslUser = 'root'
    $script:HabitatControlBaseUrl = 'http://127.0.0.1:9240'
    $script:HabitatHealthUrls = @('http://127.0.0.1:9240/status', 'http://127.0.0.1:9260/status', 'http://127.0.0.1:9270/health', 'http://127.0.0.1:9271/status', 'http://127.0.0.1:9272/status')
    return
  }
  if ($InstallRoot -notmatch '^/home/([^/]+)/\.local/share/habitat(?:-[^/]+)?$') { throw 'Invalid Habitat InstallRoot' }
  $script:HabitatWslUser = $Matches[1]
  $script:HabitatControlBaseUrl = 'http://127.0.0.1:10240'
  $script:HabitatHealthUrls = @('http://127.0.0.1:10240/status', 'http://127.0.0.1:10260/status', 'http://127.0.0.1:10270/health', 'http://127.0.0.1:10271/status', 'http://127.0.0.1:10272/status')
}

function Get-HabitatNodePath {
  param([scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command })
  $execStart = & $Wsl 'systemctl show habitat-agent -p ExecStart --value'
  if ($execStart -notmatch '(/[^\s;]+/node)\b') { throw 'Cannot resolve Habitat Node runtime from ExecStart' }
  return $Matches[1]
}

function Invoke-WslNative {
  param([string]$Command)
  $userArgs = @()
  if ($script:HabitatWslUser) { $userArgs = @('-u', $script:HabitatWslUser) }
  $output = & wsl.exe -d $script:HabitatDistro @userArgs -- bash -lc $Command 2>&1
  if ($LASTEXITCODE -ne 0) { throw "WSL command failed: $output" }
  return $output
}

function Invoke-ControlHttp {
  param([string]$Method, [string]$Path, [string]$Token = $null)
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $params = @{
    Method = $Method
    Uri = "$script:HabitatControlBaseUrl$Path"
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
  $checks = $script:HabitatHealthUrls
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
    [string]$Distro = 'Ubuntu',
    [string]$InstallRoot = ''
  )
  $script:HabitatDistro = $Distro
  Set-HabitatInstance $InstallRoot
  $keepalive = Start-HabitatWsl -Wsl $Wsl -ProcessStarter $ProcessStarter -Distro $Distro
  if ($InstallRoot) {
    $node = "$InstallRoot/runtime/node22/bin/node"
    $prefix = "HABITAT_LIFECYCLE_FILE=$InstallRoot/data/lifecycle.json HABITAT_EPISODE_DIR=$InstallRoot/data/episodes HABITAT_AFTER_ACTION_FILE=$InstallRoot/data/after-action.jsonl HABITAT_SKILL_LIBRARY=$InstallRoot/data/skill-library.json HABITAT_EPISODE_ID=installed-current"
    $instanceState = ((& $Wsl "$node $InstallRoot/app/tools/instance-supervisor.mjs status --root $InstallRoot" | Out-String).Trim() | ConvertFrom-Json)
    $needsStart = -not ($instanceState.supervisorRunning -and @('starting', 'running') -contains $instanceState.state)
    if ($instanceState.state -eq 'recovery_required') { throw 'Instance recovery required; stop orphaned services before restart' }
    if ($needsStart) {
      & $Wsl "$prefix $node $InstallRoot/app/tools/lifecycle.mjs boot" | Out-Null
      & $Wsl "$node $InstallRoot/app/tools/instance-supervisor.mjs start --root $InstallRoot" | Out-Null
    }
  } else {
    $node = Get-HabitatNodePath -Wsl $Wsl
    & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs boot" | Out-Null
    & $Wsl 'bash /opt/habitat/app/tools/wsl-start-adapters.sh' | Out-Null
    & $Wsl 'systemctl start habitat-stage.service habitat-control.service habitat-desktop.service habitat-voice.service habitat-audio.service habitat-outlet-supervisor.service habitat-agent.service fishbowl-body.service fishbowl-world.service' | Out-Null
  }
  & $Health | Out-Null
  if ($InstallRoot) {
    if ($needsStart) { & $Wsl "$prefix $node $InstallRoot/app/tools/lifecycle.mjs ready" | Out-Null }
  } else {
    & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs ready" | Out-Null
  }
  $status = & $Http 'GET' '/lifecycle' $null
  return @{ status = $status; keepaliveProcess = $keepalive }
}

function Stop-HabitatLifecycle {
  param(
    [scriptblock]$Wsl = { param($Command) Invoke-WslNative $Command },
    [string]$Distro = 'Ubuntu',
    [string]$InstallRoot = ''
  )
  $script:HabitatDistro = $Distro
  Set-HabitatInstance $InstallRoot
  if ($InstallRoot) {
    $node = "$InstallRoot/runtime/node22/bin/node"
    $prefix = "HABITAT_LIFECYCLE_FILE=$InstallRoot/data/lifecycle.json HABITAT_EPISODE_DIR=$InstallRoot/data/episodes HABITAT_AFTER_ACTION_FILE=$InstallRoot/data/after-action.jsonl HABITAT_SKILL_LIBRARY=$InstallRoot/data/skill-library.json HABITAT_EPISODE_ID=installed-current"
    & $Wsl "$prefix $node $InstallRoot/app/tools/lifecycle.mjs stopping" | Out-Null
    & $Wsl "$node $InstallRoot/app/tools/instance-supervisor.mjs stop --root $InstallRoot" | Out-Null
    & $Wsl "$prefix $node $InstallRoot/app/tools/lifecycle.mjs stopped" | Out-Null
  } else {
    $node = Get-HabitatNodePath -Wsl $Wsl
    & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs stopping" | Out-Null
    & $Wsl 'bash /opt/habitat/app/tools/wsl-stop.sh' | Out-Null
    & $Wsl "$node /opt/habitat/app/tools/lifecycle.mjs stopped" | Out-Null
  }
  return @{ state = 'stopped'; wslShutdown = $false }
}

function Get-HabitatLifecycleStatus {
  param(
    [scriptblock]$Http = { param($Method, $Path, $Token) Invoke-ControlHttp $Method $Path $Token },
    [string]$InstallRoot = ''
  )
  Set-HabitatInstance $InstallRoot
  return & $Http 'GET' '/lifecycle' $null
}

function Invoke-HabitatRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Token,
    [scriptblock]$Http = { param($Method, $Path, $Token) Invoke-ControlHttp $Method $Path $Token },
    [string]$InstallRoot = ''
  )
  Set-HabitatInstance $InstallRoot
  if ([string]::IsNullOrWhiteSpace($Token)) { throw 'owner token required' }
  return & $Http 'POST' '/recovery' $Token
}

Export-ModuleMember -Function Start-HabitatLifecycle, Stop-HabitatLifecycle, Get-HabitatLifecycleStatus, Invoke-HabitatRecovery, Start-HabitatWsl
