# Habitat Windows 统一入口：客户端、启动、停止、状态和异常恢复共用同一生命周期模块。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('client', 'start', 'stop', 'status', 'resume')]
  [string]$Action,
  [string]$Distro = 'Ubuntu',
  [string]$InstallRoot = ''
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force
switch ($Action) {
  'client' { & (Join-Path $PSScriptRoot 'client.ps1') -Distro $Distro -InstallRoot $InstallRoot }
  'start' { Start-HabitatLifecycle -Distro $Distro -InstallRoot $InstallRoot }
  'resume' { Start-HabitatLifecycle -Distro $Distro -InstallRoot $InstallRoot }
  'status' { Get-HabitatLifecycleStatus -InstallRoot $InstallRoot }
  'stop' { Stop-HabitatLifecycle -Distro $Distro -InstallRoot $InstallRoot }
}
