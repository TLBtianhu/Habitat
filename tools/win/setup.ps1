# Habitat 单用户安装器：staging、回滚、当前用户注册与卸载保留数据。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('install', 'upgrade', 'uninstall', 'status')][string]$Action,
  [string]$PackagePath = '',
  [string]$PayloadRoot = $PSScriptRoot,
  [string]$InstallRoot = '',
  [string]$Version = '0.1.0',
  [string]$RuntimeUrl = '',
  [string]$RuntimeSha256 = '',
  [string]$ClientDir = "$env:LOCALAPPDATA\Habitat\client",
  [string]$RegistryRoot = 'HKCU:\Software\Habitat',
  [string]$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Habitat',
  [string]$ProtocolRoot = 'HKCU:\Software\Classes\habitat',
  [string]$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Habitat",
  [switch]$SimulateFailure
)
$ErrorActionPreference = 'Stop'
if ($env:HABITAT_CLIENT_DIR) { $ClientDir = $env:HABITAT_CLIENT_DIR }
if ($env:HABITAT_REGISTRY_ROOT) { $RegistryRoot = $env:HABITAT_REGISTRY_ROOT }
if ($env:HABITAT_UNINSTALL_KEY) { $UninstallKey = $env:HABITAT_UNINSTALL_KEY }
if ($env:HABITAT_PROTOCOL_ROOT) { $ProtocolRoot = $env:HABITAT_PROTOCOL_ROOT }
if ($env:HABITAT_START_MENU_DIR) { $StartMenuDir = $env:HABITAT_START_MENU_DIR }
$linuxHome = (wsl -d Ubuntu -- bash -lc 'printf %s "$HOME"').Trim()
if (-not $linuxHome) { throw '无法确定 WSL 用户 home' }
if (-not $InstallRoot) { $InstallRoot = "$linuxHome/.local/share/habitat" }
$InstallRoot = $InstallRoot.TrimEnd('/')
if ($InstallRoot -notmatch '^/home/[^/]+/\.local/share/habitat(?:-[^/]+)?$') { throw 'InstallRoot 必须是用户目录下的独立 Habitat 实例' }

function Register-Client {
  New-Item -ItemType Directory -Path $ClientDir -Force | Out-Null
  $tools = Join-Path $ClientDir 'tools\win'
  New-Item -ItemType Directory -Path $tools -Force | Out-Null
  $files = @('client.ps1', 'lifecycle.psm1', 'habitat.ps1', 'resume-habitat.ps1', 'setup.ps1', 'HabitatConsole.exe', 'HabitatSetup.exe')
  foreach ($file in $files) {
    $source = Join-Path $PayloadRoot "tools\win\$file"
    if (-not (Test-Path $source)) { throw "缺少客户端载荷: $file" }
    Copy-Item $source (Join-Path $tools $file) -Force
  }
  Copy-Item (Join-Path $PayloadRoot 'tools\win\HabitatConsole.exe') (Join-Path $ClientDir 'HabitatConsole.exe') -Force
  Copy-Item (Join-Path $PayloadRoot 'tools\win\HabitatSetup.exe') (Join-Path $ClientDir 'HabitatSetup.exe') -Force

  New-Item -Path $RegistryRoot -Force | Out-Null
  Set-ItemProperty -Path $RegistryRoot -Name InstallRoot -Value $InstallRoot
  Set-ItemProperty -Path $RegistryRoot -Name ClientDir -Value $ClientDir
  Set-ItemProperty -Path $RegistryRoot -Name Version -Value $Version
  Set-ItemProperty -Path $RegistryRoot -Name DataRoot -Value "$InstallRoot/data"
  Set-ItemProperty -Path $RegistryRoot -Name ConfigRoot -Value "$InstallRoot/config"
  New-Item -Path $UninstallKey -Force | Out-Null
  Set-ItemProperty -Path $UninstallKey -Name DisplayName -Value 'Habitat'
  Set-ItemProperty -Path $UninstallKey -Name DisplayVersion -Value $Version
  Set-ItemProperty -Path $UninstallKey -Name InstallLocation -Value $ClientDir
  Set-ItemProperty -Path $UninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$tools\setup.ps1`" -Action uninstall"
  New-Item -Path "$ProtocolRoot\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path "$ProtocolRoot\shell\open\command" -Name '(default)' -Value "`"$ClientDir\HabitatConsole.exe`" `"%1`""
  New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  foreach ($entry in @(@{ Name = 'Habitat'; Target = 'HabitatConsole.exe' }, @{ Name = 'Habitat Setup'; Target = 'HabitatSetup.exe' })) {
    $shortcut = $shell.CreateShortcut((Join-Path $StartMenuDir ($entry.Name + '.lnk')))
    $shortcut.TargetPath = Join-Path $ClientDir $entry.Target
    $shortcut.WorkingDirectory = $ClientDir
    $shortcut.Save()
  }
}

if ($Action -eq 'status') {
  if (-not (Test-Path $RegistryRoot)) { return @{ installed = $false } }
  $values = Get-ItemProperty -Path $RegistryRoot
  return @{ installed = $true; installRoot = $values.InstallRoot; clientDir = $values.ClientDir; version = $values.Version; dataRoot = $values.DataRoot; configRoot = $values.ConfigRoot }
}

if ($Action -eq 'uninstall') {
  if (Test-Path $ClientDir) { Remove-Item -LiteralPath $ClientDir -Recurse -Force }
  wsl -d Ubuntu -- bash -lc "rm -rf -- '$InstallRoot/app' '$InstallRoot/runtime'"
  if ($LASTEXITCODE -ne 0) { throw '卸载应用目录失败；数据已保留' }
  Remove-Item -Path $RegistryRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $ProtocolRoot -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $StartMenuDir) { Remove-Item -LiteralPath $StartMenuDir -Recurse -Force }
  Write-Output "已卸载应用；数据与配置保留在 $InstallRoot/data 和 $InstallRoot/config"
  return
}

if (-not $PackagePath) { $PackagePath = Join-Path $PayloadRoot 'payload\fishbowl-v0.1.zip' }
if (-not $RuntimeUrl) {
  $lockPath = Join-Path $PayloadRoot 'runtime\lock.json'
  if (-not (Test-Path $lockPath)) { throw '缺少 runtime/lock.json，不能静默替换运行时' }
  $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
  $RuntimeUrl = $lock.source
  $RuntimeSha256 = $lock.sha256
}
$PackagePath = (Resolve-Path $PackagePath).Path
$staging = "$InstallRoot/.staging-$([guid]::NewGuid().ToString('N'))"
$backup = "$InstallRoot/.backup-$([guid]::NewGuid().ToString('N'))"
$swapped = $false
wsl -d Ubuntu -- bash -lc "mkdir -p '$staging/data' && if [ -f '$InstallRoot/data/runtime.tar.gz' ]; then cp '$InstallRoot/data/runtime.tar.gz' '$staging/data/runtime.tar.gz'; fi"
try {
  & (Join-Path $PSScriptRoot 'install-user.ps1') -PackagePath $PackagePath -InstallRoot $staging -RuntimeUrl $RuntimeUrl -RuntimeSha256 $RuntimeSha256
  foreach ($required in @('agent/run-continuous.mjs', 'tools/win/client.ps1', 'tools/lifecycle.mjs')) {
    wsl -d Ubuntu -- bash -lc "test -f '$staging/app/$required'"
    if ($LASTEXITCODE -ne 0) { throw "安装包缺少 $required" }
  }
  wsl -d Ubuntu -- bash -lc "mkdir -p '$backup' && if [ -d '$InstallRoot/app' ]; then mv '$InstallRoot/app' '$backup/app'; fi && if [ -d '$InstallRoot/runtime' ]; then mv '$InstallRoot/runtime' '$backup/runtime'; fi && mv '$staging/app' '$InstallRoot/app' && if [ -d '$staging/runtime' ]; then mv '$staging/runtime' '$InstallRoot/runtime'; fi"
  if ($LASTEXITCODE -ne 0) { throw '应用目录切换失败' }
  $swapped = $true
  if ($SimulateFailure) { throw '模拟健康检查失败' }
  wsl -d Ubuntu -- bash -lc "mkdir -p '$InstallRoot/data' '$InstallRoot/config' && chmod -R u+rwX,go-rwx '$InstallRoot/data' '$InstallRoot/config'"
  if ($LASTEXITCODE -ne 0) { throw '无法创建正式数据/配置目录' }
  Register-Client
} catch {
  wsl -d Ubuntu -- bash -lc "rm -rf '$InstallRoot/app' '$InstallRoot/runtime' && if [ -d '$backup/app' ]; then mv '$backup/app' '$InstallRoot/app'; fi && if [ -d '$backup/runtime' ]; then mv '$backup/runtime' '$InstallRoot/runtime'; fi"
  wsl -d Ubuntu -- bash -lc "rm -rf '$staging' '$backup'"
  throw
}
wsl -d Ubuntu -- bash -lc "rm -rf '$staging' '$backup'"
Write-Output "Habitat $Version 已安装；应用、数据、配置与开发目录隔离"
