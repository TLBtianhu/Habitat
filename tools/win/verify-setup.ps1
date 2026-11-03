# Habitat Setup/Console EXE 真实安装验收：使用独立 WSL 实例和测试注册表项。
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$payloadRoot = Join-Path $root 'dist\win'
$package = Join-Path $payloadRoot 'payload\fishbowl-v0.1.zip'
$setupExe = Join-Path $payloadRoot 'tools\win\HabitatSetup.exe'
$standaloneDir = Join-Path $root '.tmp\standalone-setup'
$standaloneExe = Join-Path $standaloneDir 'HabitatSetup.exe'
$setupScript = Join-Path $payloadRoot 'tools\win\setup.ps1'
$defaultWslUser = (wsl -d Ubuntu -- whoami).Trim()
if ($defaultWslUser -eq 'root') {
  wsl -d Ubuntu -u root -- bash -lc "id -u habitat >/dev/null 2>&1 || useradd -m habitat; chown -R habitat:habitat /home/habitat"
  $linuxHome = '/home/habitat'
} else {
  $linuxHome = (wsl -d Ubuntu -- bash -lc 'printf %s "$HOME"').Trim()
}
$installRoot = "$linuxHome/.local/share/habitat-test"
$runtimeArchive = if ($env:HABITAT_TEST_RUNTIME_ARCHIVE) { $env:HABITAT_TEST_RUNTIME_ARCHIVE } else { '/tmp/habitat-runtime-core-0.1.1.tar.gz' }
$env:HABITAT_INSTALL_ROOT = $installRoot
$clientDir = Join-Path $root '.tmp\setup-client'
$startMenuDir = Join-Path $root '.tmp\setup-start-menu'
$env:HABITAT_CLIENT_DIR = $clientDir
$env:HABITAT_REGISTRY_ROOT = 'HKCU:\Software\Habitat-Test'
$env:HABITAT_UNINSTALL_KEY = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Habitat-Test'
$env:HABITAT_PROTOCOL_ROOT = 'HKCU:\Software\Classes\habitat-test'
$env:HABITAT_START_MENU_DIR = $startMenuDir
function Cleanup {
  param([switch]$KeepEnvironment)
  wsl -d Ubuntu -- bash -lc "rm -rf -- '$installRoot'" | Out-Null
  Remove-Item -LiteralPath $clientDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $standaloneDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_REGISTRY_ROOT -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_UNINSTALL_KEY -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_PROTOCOL_ROOT -Recurse -Force -ErrorAction SilentlyContinue
  if (-not $KeepEnvironment) {
    Remove-Item Env:HABITAT_CLIENT_DIR,Env:HABITAT_REGISTRY_ROOT,Env:HABITAT_UNINSTALL_KEY,Env:HABITAT_PROTOCOL_ROOT,Env:HABITAT_START_MENU_DIR,Env:HABITAT_INSTALL_ROOT -ErrorAction SilentlyContinue
  }
}
Cleanup -KeepEnvironment
wsl -d Ubuntu -- bash -lc "mkdir -p '$installRoot/data' && if [ -f '$runtimeArchive' ]; then cp '$runtimeArchive' '$installRoot/data/runtime.tar.gz'; fi"
New-Item -ItemType Directory -Path $standaloneDir -Force | Out-Null
Copy-Item -LiteralPath $setupExe -Destination $standaloneExe -Force
try {
  & $standaloneExe upgrade $package $installRoot
  if ($LASTEXITCODE -ne 0) { throw 'Setup EXE 安装失败' }
  wsl -d Ubuntu -- bash -lc "test -f '$installRoot/app/agent/run-continuous.mjs' && test -x '$installRoot/runtime/node22/bin/node' && test -d '$installRoot/data' && test -d '$installRoot/config'"
  if ($LASTEXITCODE -ne 0) { throw '安装应用、运行时或数据目录不存在' }
  if (-not (Test-Path (Join-Path $clientDir 'HabitatConsole.exe'))) { throw '控制台 EXE 未安装' }
  $registry = Get-ItemProperty $env:HABITAT_REGISTRY_ROOT
  if ($registry.InstallRoot -ne $installRoot -or $registry.ClientDir -ne $clientDir) { throw '注册表实例路径错误' }
  if (-not (Test-Path $env:HABITAT_UNINSTALL_KEY)) { throw '缺少卸载入口' }
  $protocol = Get-ItemProperty "$env:HABITAT_PROTOCOL_ROOT\shell\open\command"
  if ($protocol.'(default)' -notmatch 'HabitatConsole.exe') { throw '协议注册错误' }
  if (-not (Test-Path (Join-Path $startMenuDir 'Habitat.lnk'))) { throw '开始菜单快捷方式缺失' }

  wsl -d Ubuntu -- bash -lc "printf old > '$installRoot/app/KEEP.txt'"
  $failed = $false
  try { & $setupScript -Action upgrade -PackagePath $package -PayloadRoot $payloadRoot -InstallRoot $installRoot -SimulateFailure } catch { $failed = $true }
  if (-not $failed) { throw '模拟升级失败必须报错' }
  $keep = (wsl -d Ubuntu -- bash -lc "cat '$installRoot/app/KEEP.txt'").Trim()
  if ($keep -ne 'old') { throw '升级失败后未恢复旧应用' }
  wsl -d Ubuntu -- bash -lc "test -d '$installRoot/data' && test -d '$installRoot/config'"
  if ($LASTEXITCODE -ne 0) { throw '回滚后数据目录丢失' }

  & $setupExe uninstall
  if ($LASTEXITCODE -ne 0) { throw 'Setup EXE 卸载失败' }
  wsl -d Ubuntu -- bash -lc "test ! -d '$installRoot/app' && test ! -d '$installRoot/runtime'"
  if ($LASTEXITCODE -ne 0) { throw '卸载后应用或运行时目录仍存在' }
  wsl -d Ubuntu -- bash -lc "test -d '$installRoot/data'"
  if ($LASTEXITCODE -ne 0) { throw '卸载后数据目录被删除' }
  wsl -d Ubuntu -- bash -lc "test -d '$installRoot/config'"
  if ($LASTEXITCODE -ne 0) { throw '卸载后配置目录被删除' }
  if (Test-Path $clientDir) { throw '客户端目录未清理' }
  if (Test-Path $env:HABITAT_REGISTRY_ROOT) { throw '实例注册表未清理' }
  if (Test-Path $env:HABITAT_UNINSTALL_KEY) { throw '卸载入口未清理' }
  if (Test-Path $env:HABITAT_PROTOCOL_ROOT) { throw '协议注册未清理' }
  if (Test-Path $startMenuDir) { throw '快捷方式未清理' }
  Write-Output 'ok: 真实 Setup EXE 安装、注册、回滚、卸载保留数据与控制台载荷'
} finally {
  Cleanup
}
