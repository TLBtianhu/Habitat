# Habitat Windows 正常停机：优雅停止声明中的服务，不关闭整个 WSL。
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force
Stop-HabitatLifecycle
