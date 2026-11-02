# Habitat 用户态安装器：默认不提权，应用/数据/配置独立，不修改全局 WSL 配置。
param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [string]$InstallRoot = '',
  [string]$RuntimeUrl = '',
  [string]$RuntimeSha256 = ''
)

$ErrorActionPreference = 'Stop'
$PackagePath = (Resolve-Path $PackagePath).Path
$linuxHome = (wsl -d Ubuntu -- bash -lc 'printf %s "$HOME"').Trim()
if ([string]::IsNullOrWhiteSpace($linuxHome)) { throw '无法确定 WSL 用户 home' }
if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = "$linuxHome/.local/share/habitat" }
$InstallRoot = $InstallRoot.TrimEnd('/')

$tmp = Join-Path $env:TEMP ('habitat-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  # 解包前拒绝绝对路径、路径穿越、过大包和链接；不在 root 下解包。
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    if ($archive.Entries.Count -gt 20000) { throw '安装包文件数超过 20000' }
    $total = 0L
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ($name.StartsWith('/') -or $name -match '^[A-Za-z]:' -or $name.Split('/') -contains '..') {
        throw "安装包包含不安全路径: $name"
      }
      if ($entry.PSObject.Properties['LinkTarget'] -and $entry.LinkTarget) { throw "安装包包含链接: $name" }
      $total += $entry.Length
    }
    if ($total -gt 4GB) { throw '安装包解压后超过 4GB' }
  } finally { $archive.Dispose() }
  Expand-Archive -Path $PackagePath -DestinationPath $tmp -Force

  $payload = Join-Path $tmp 'Fishbowl'
  if (-not (Test-Path $payload)) { $payload = $tmp }
  $wslTmp = '/mnt/' + $payload.Substring(0, 1).ToLower() + $payload.Substring(2).Replace('\', '/')
  wsl -d Ubuntu -- bash -lc "mkdir -p '$InstallRoot/app' '$InstallRoot/data' '$InstallRoot/config'"
  wsl -d Ubuntu -- bash -lc "cp -a '$wslTmp'/. '$InstallRoot/app/'"
  wsl -d Ubuntu -- bash -lc "chmod -R u+rwX,go+rX,go-w '$InstallRoot/app'; chmod -R u+rwX,go-rwx '$InstallRoot/data' '$InstallRoot/config'"

  if ($RuntimeUrl) {
    if ([string]::IsNullOrWhiteSpace($RuntimeSha256)) { throw 'RuntimeUrl 必须同时提供 RuntimeSha256' }
    $uri = [uri]$RuntimeUrl
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('www.modelscope.cn', 'hf-mirror.com', 'huggingface.co')) {
      throw 'RuntimeUrl 只允许 HTTPS 的官方/镜像源'
    }
    wsl -d Ubuntu -- bash -lc "curl --fail --location --proto '=https' '$RuntimeUrl' -o '$InstallRoot/data/runtime.tar.gz'"
    if ($LASTEXITCODE -ne 0) { throw '运行时下载失败' }
    wsl -d Ubuntu -- bash -lc "printf '%s  %s\n' '$RuntimeSha256' '$InstallRoot/data/runtime.tar.gz' | sha256sum -c -"
    if ($LASTEXITCODE -ne 0) { throw '运行时 SHA256 校验失败' }
  } else {
    Write-Output '未提供 RuntimeUrl：应用层已安装，运行时需另行按 manifest 校验安装'
  }

  Write-Output "应用已安装到 $InstallRoot/app"
  Write-Output "用户数据：$InstallRoot/data；配置：$InstallRoot/config"
  Write-Output '本安装未请求管理员/root，也未修改全局 WSL 配置'
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}
