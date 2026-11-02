# Habitat 薄启动器：由 Windows 生命周期模块检测并启动 WSL 与核心服务。
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force
Start-HabitatLifecycle
