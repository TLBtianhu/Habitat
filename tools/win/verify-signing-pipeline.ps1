# 使用短期自签名证书验证签名结构、时间戳和哈希，不用于生产信任声明。
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $root 'dist\win'
$target = Join-Path $root 'dist\signing-test'
if (-not (Test-Path (Join-Path $source 'tools\win\HabitatSetup.exe'))) { throw '先构建 dist\win' }
if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
$cert = New-SelfSignedCertificate -Subject 'CN=Habitat Signing Pipeline Test' -Type CodeSigningCert -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(1)
try {
  $signTool = & (Join-Path $PSScriptRoot 'install-signing-tools.ps1')
  & (Join-Path $PSScriptRoot 'sign-release.ps1') -DistDir $target -Thumbprint $cert.Thumbprint -SignToolPath $signTool -AllowTestSigning | Out-Null
  & (Join-Path $PSScriptRoot 'verify-signing.ps1') -DistDir $target | Out-Null
  node (Join-Path $root 'tools\verify-win-release.mjs') $target
  if ($LASTEXITCODE -ne 0) { throw '签名后的哈希清单校验失败' }
  Write-Output 'ok: Authenticode 结构、时间戳和签名后哈希通过；测试证书未声明生产信任'
} finally {
  Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
  if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
