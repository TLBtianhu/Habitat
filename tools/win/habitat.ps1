# Habitat 统一入口：稳定版启动器/关闭按钮只调用此文件。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'stop', 'status', 'resume')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'
$root = 'C:\Habitat\tools\win'
switch ($Action) {
  'start' {
    & (Join-Path $root 'start-wsl.ps1')
    & (Join-Path $root 'resume-habitat.ps1')
  }
  'resume' {
    & (Join-Path $root 'start-wsl.ps1')
    & (Join-Path $root 'resume-habitat.ps1')
  }
  'status' {
    & (Join-Path $root 'resume-habitat.ps1')
  }
  'stop' {
    & (Join-Path $root 'stop-habitat.ps1')
  }
}
