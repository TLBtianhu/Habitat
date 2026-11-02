# Habitat Windows 统一入口：客户端、启动、停止、状态和异常恢复共用同一生命周期模块。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('client', 'start', 'stop', 'status', 'resume')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force
switch ($Action) {
  'client' { & (Join-Path $PSScriptRoot 'client.ps1') }
  'start' { Start-HabitatLifecycle }
  'resume' { Start-HabitatLifecycle }
  'status' { Get-HabitatLifecycleStatus }
  'stop' { Stop-HabitatLifecycle }
}
