# 下载并校验微软官方 BuildTools，返回 x64 SignTool 路径；不安装系统 SDK。
[CmdletBinding()]
param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\..\.tmp\buildtools'),
  [string]$Version = '10.0.26100.9457',
  [string]$ExpectedSha512 = 'bVwznDT8AETSle4ePhMLXMFrjvLjHje6AoHzX0cZgJ7nhBfixZID1t5GJvpiNANNbndO58BbLv9VfMHUbQ9mTA=='
)
$ErrorActionPreference = 'Stop'
$signTool = Join-Path $Destination "bin\10.0.26100.0\x64\signtool.exe"
if (Test-Path $signTool) { return $signTool }
$base = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$Version"
$package = Join-Path $env:TEMP "habitat-buildtools-$Version.nupkg"
curl.exe -L --fail --max-time 180 -o $package "$base/microsoft.windows.sdk.buildtools.$Version.nupkg"
if ($LASTEXITCODE -ne 0) { throw 'BuildTools 下载失败' }
$actual = [BitConverter]::ToString([Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($package))).Replace('-', '').ToLowerInvariant()
$expected = [BitConverter]::ToString([Convert]::FromBase64String($ExpectedSha512)).Replace('-', '').ToLowerInvariant()
if ($actual -ne $expected) { throw 'BuildTools SHA512 校验失败' }
if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($package, $Destination)
Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $signTool)) { throw 'BuildTools 中缺少 signtool.exe' }
return $signTool
