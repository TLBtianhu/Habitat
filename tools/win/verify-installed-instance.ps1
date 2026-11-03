# 安装版独立用户实例真实启停与崩溃清理验收。
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$payloadRoot = Join-Path $root 'dist\win'
$package = Join-Path $payloadRoot 'payload\fishbowl-v0.1.zip'
$setupScript = Join-Path $payloadRoot 'tools\win\setup.ps1'
$defaultWslUser = (wsl -d Ubuntu -- whoami).Trim()
if ($defaultWslUser -eq 'root') {
  wsl -d Ubuntu -u root -- bash -lc "id -u habitat >/dev/null 2>&1 || useradd -m habitat; chown -R habitat:habitat /home/habitat"
  $linuxHome = '/home/habitat'
  $wslUser = 'habitat'
} else {
  $linuxHome = (wsl -d Ubuntu -- bash -lc 'printf %s "$HOME"').Trim()
  $wslUser = $defaultWslUser
}
$installRoot = "$linuxHome/.local/share/habitat-instance-test"
$env:HABITAT_INSTALL_ROOT = $installRoot
$env:HABITAT_CLIENT_DIR = Join-Path $root '.tmp\instance-client'
$env:HABITAT_REGISTRY_ROOT = 'HKCU:\Software\Habitat-Instance-Test'
$env:HABITAT_UNINSTALL_KEY = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Habitat-Instance-Test'
$env:HABITAT_PROTOCOL_ROOT = 'HKCU:\Software\Classes\habitat-instance-test'
$env:HABITAT_START_MENU_DIR = Join-Path $root '.tmp\instance-start-menu'
$runtimeArchive = if ($env:HABITAT_TEST_RUNTIME_ARCHIVE) { $env:HABITAT_TEST_RUNTIME_ARCHIVE } else { '/tmp/habitat-runtime-core-0.1.1.tar.gz' }
function Remove-TestInstance {
  if ($installRoot -notmatch '^/home/[^/]+/\.local/share/habitat-instance-test$') { throw 'unexpected test root' }
  wsl -d Ubuntu -u $wslUser -- bash -lc "if [ -x '$installRoot/runtime/node22/bin/node' ] && [ -f '$installRoot/app/tools/instance-supervisor.mjs' ]; then '$installRoot/runtime/node22/bin/node' '$installRoot/app/tools/instance-supervisor.mjs' stop --root '$installRoot' >/dev/null 2>&1; fi"
  if ($LASTEXITCODE -eq 0) {
    wsl -d Ubuntu -u root -- bash -lc "rm -rf -- '$installRoot'" | Out-Null
  } else {
    Write-Warning 'test instance did not stop cleanly; root retained for diagnosis'
  }
  Remove-Item -LiteralPath $env:HABITAT_CLIENT_DIR -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $env:HABITAT_START_MENU_DIR -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_REGISTRY_ROOT -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_UNINSTALL_KEY -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $env:HABITAT_PROTOCOL_ROOT -Recurse -Force -ErrorAction SilentlyContinue
}
function Assert-Instance([string]$Mode) {
  wsl -d Ubuntu -u $wslUser -- "$installRoot/runtime/node22/bin/node" "$installRoot/app/tools/verify-instance.mjs" $Mode
  if ($LASTEXITCODE -ne 0) { throw "instance verification failed: $Mode" }
}
Remove-TestInstance
wsl -d Ubuntu -u $wslUser -- bash -lc "mkdir -p '$installRoot/data' && if [ -f '$runtimeArchive' ]; then cp '$runtimeArchive' '$installRoot/data/runtime.tar.gz'; fi"
try {
  & $setupScript -Action install -PackagePath $package -PayloadRoot $payloadRoot -InstallRoot $installRoot
  & (Join-Path $root 'tools\win\habitat.ps1') -Action start -InstallRoot $installRoot | Out-Null
  Assert-Instance running
  if ($LASTEXITCODE -ne 0) { throw 'installed instance health failed' }
  $status = (wsl -d Ubuntu -u $wslUser -- "$installRoot/runtime/node22/bin/node" "$installRoot/app/tools/instance-supervisor.mjs" status --root $installRoot | ConvertFrom-Json)
  if ($status.state -ne 'running' -or $status.configurationRequired -notcontains 'llm') { throw 'missing LLM must be configuration_required' }
  if ($status.services.PSObject.Properties.Name -contains 'agent') { throw 'agent must not start without LLM config' }

  # 重复启动必须幂等，不创建第二套进程。
  & (Join-Path $root 'tools\win\habitat.ps1') -Action start -InstallRoot $installRoot | Out-Null
  Assert-Instance running
  wsl -d Ubuntu -u $wslUser -- "$installRoot/runtime/node22/bin/node" "$installRoot/app/tools/verify-settings-live.mjs" $installRoot
  if ($LASTEXITCODE -ne 0) { throw 'settings live apply failed' }

  # 只杀测试 supervisor，保留子进程，验证 recovery_required 与安全清理。
  $status = (wsl -d Ubuntu -u $wslUser -- "$installRoot/runtime/node22/bin/node" "$installRoot/app/tools/instance-supervisor.mjs" status --root $installRoot | ConvertFrom-Json)
  $cmdline = (wsl -d Ubuntu -u $wslUser -- bash -lc "tr '\0' ' ' < '/proc/$($status.pid)/cmdline'").Trim()
  if ($cmdline -notmatch 'instance-supervisor\.mjs' -or $cmdline -notmatch [regex]::Escape($installRoot)) { throw 'refusing to kill unverified supervisor pid' }
  wsl -d Ubuntu -u $wslUser -- kill -KILL $status.pid
  Start-Sleep -Seconds 1
  $crashed = (wsl -d Ubuntu -u $wslUser -- "$installRoot/runtime/node22/bin/node" "$installRoot/app/tools/instance-supervisor.mjs" status --root $installRoot | ConvertFrom-Json)
  if ($crashed.state -ne 'recovery_required') { throw 'orphan children must require recovery' }
  & (Join-Path $root 'tools\win\habitat.ps1') -Action stop -InstallRoot $installRoot | Out-Null
  Assert-Instance stopped

  # 清理后能重新启动，再正常停止；开发实例始终不受影响。
  & (Join-Path $root 'tools\win\habitat.ps1') -Action start -InstallRoot $installRoot | Out-Null
  Assert-Instance running
  & (Join-Path $root 'tools\win\habitat.ps1') -Action stop -InstallRoot $installRoot | Out-Null
  Assert-Instance stopped
  $life = (wsl -d Ubuntu -u $wslUser -- bash -lc "HABITAT_LIFECYCLE_FILE='$installRoot/data/lifecycle.json' HABITAT_EPISODE_DIR='$installRoot/data/episodes' HABITAT_AFTER_ACTION_FILE='$installRoot/data/after-action.jsonl' HABITAT_SKILL_LIBRARY='$installRoot/data/skill-library.json' HABITAT_EPISODE_ID=installed-current '$installRoot/runtime/node22/bin/node' '$installRoot/app/tools/lifecycle.mjs' status" | ConvertFrom-Json)
  if ($life.state -ne 'stopped') { throw 'installed lifecycle must be stopped' }
  & $setupScript -Action uninstall -InstallRoot $installRoot -PayloadRoot $payloadRoot
  wsl -d Ubuntu -u $wslUser -- bash -lc "test ! -d '$installRoot/app' && test ! -d '$installRoot/runtime' && test -d '$installRoot/data' && test -d '$installRoot/config'"
  if ($LASTEXITCODE -ne 0) { throw 'uninstall must retain data/config' }
  Write-Output 'ok: installed instance start/stop, idempotency, orphan recovery, coexistence and uninstall'
} finally {
  Remove-TestInstance
  Remove-Item Env:HABITAT_INSTALL_ROOT,Env:HABITAT_CLIENT_DIR,Env:HABITAT_REGISTRY_ROOT,Env:HABITAT_UNINSTALL_KEY,Env:HABITAT_PROTOCOL_ROOT,Env:HABITAT_START_MENU_DIR -ErrorAction SilentlyContinue
}
