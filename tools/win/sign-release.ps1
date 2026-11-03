# Habitat Authenticode 签名：使用现有证书或临时导入 PFX，私钥/密码不写入仓库。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DistDir,
  [string]$Thumbprint = '',
  [string]$PfxPath = '',
  [string]$SignToolPath = '',
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$AllowTestSigning,
  [switch]$AllowNoTimestamp
)
$ErrorActionPreference = 'Stop'
$DistDir = (Resolve-Path $DistDir).Path
if (-not $SignToolPath) {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { $SignToolPath = $command.Source } else { $SignToolPath = & (Join-Path $PSScriptRoot 'install-signing-tools.ps1') }
}
$SignToolPath = (Resolve-Path $SignToolPath).Path
$importedThumbprint = ''
try {
  if ($PfxPath) {
    $PfxPath = (Resolve-Path $PfxPath).Path
    if ($env:HABITAT_CODESIGN_PASSWORD) {
      $secure = ConvertTo-SecureString $env:HABITAT_CODESIGN_PASSWORD -AsPlainText -Force
    } else {
      $secure = Read-Host '输入代码签名 PFX 密码（不显示）' -AsSecureString
    }
    $cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation 'Cert:\CurrentUser\My' -Password $secure
    $importedThumbprint = $cert.Thumbprint
    $Thumbprint = $importedThumbprint
  }
  if (-not $Thumbprint) {
    $candidates = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) })
    if ($candidates.Count -ne 1) { throw '请用 Thumbprint 明确选择代码签名证书' }
    $Thumbprint = $candidates[0].Thumbprint
  }
  $cert = Get-Item "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction Stop
  if (-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date)) { throw '代码签名证书缺少私钥或已过期' }

  foreach ($name in @('HabitatSetup.exe', 'HabitatConsole.exe')) {
    $file = Join-Path $DistDir "tools\win\$name"
    if (-not (Test-Path $file)) { throw "缺少签名目标: $name" }
    $signArgs = @('sign', '/fd', 'SHA256', '/sha1', $Thumbprint, '/d', 'Habitat', '/du', 'https://github.com/TLBtianhu/Habitat')
    if (-not $AllowNoTimestamp) { $signArgs += @('/td', 'SHA256', '/tr', $TimestampUrl) }
    $signArgs += $file
    & $SignToolPath @signArgs
    if ($LASTEXITCODE -ne 0) { throw "签名失败: $name" }
  }

  $results = @()
  foreach ($name in @('HabitatSetup.exe', 'HabitatConsole.exe')) {
    $file = Join-Path $DistDir "tools\win\$name"
    $signature = Get-AuthenticodeSignature -FilePath $file
    if (-not $signature.SignerCertificate -or $signature.Status -eq 'HashMismatch' -or $signature.Status -eq 'NotSigned') { throw "没有有效签名结构: $name" }
    $trusted = $signature.Status -eq 'Valid'
    $hasTimestamp = $null -ne $signature.TimeStamperCertificate
    if (-not $AllowTestSigning -and -not $trusted) { throw "签名证书链不受信任: $name ($($signature.Status))" }
    if (-not $AllowNoTimestamp -and -not $hasTimestamp) { throw "缺少 RFC3161 时间戳: $name" }
    $results += @{ file = $name; signaturePresent = $true; trusted = $trusted; status = [string]$signature.Status; hasTimestamp = $hasTimestamp; subject = $signature.SignerCertificate.Subject; issuer = $signature.SignerCertificate.Issuer }
  }
  $sums = @()
  foreach ($rel in @('tools/win/HabitatSetup.exe', 'tools/win/HabitatConsole.exe', 'payload/fishbowl-v0.1.zip')) {
    $file = Join-Path $DistDir $rel
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $sums += "$hash  $($rel.Replace('\', '/'))"
  }
  [IO.File]::WriteAllText((Join-Path $DistDir 'SHA256SUMS.txt'), ($sums -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
  $results | ConvertTo-Json -Depth 5
} finally {
  if ($importedThumbprint) { Remove-Item "Cert:\CurrentUser\My\$importedThumbprint" -Force -ErrorAction SilentlyContinue }
}
