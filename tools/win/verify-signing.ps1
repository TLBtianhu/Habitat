# 独立验签：区分“存在签名”与“证书链受信任”，测试签名不得冒充正式可信发行。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DistDir,
  [switch]$RequireTrusted,
  [switch]$AllowNoTimestamp
)
$ErrorActionPreference = 'Stop'
$DistDir = (Resolve-Path $DistDir).Path
$results = @()
foreach ($name in @('HabitatSetup.exe', 'HabitatConsole.exe')) {
  $file = Join-Path $DistDir "tools\win\$name"
  $signature = Get-AuthenticodeSignature -FilePath $file
  if (-not $signature.SignerCertificate -or $signature.Status -eq 'HashMismatch' -or $signature.Status -eq 'NotSigned') { throw "签名结构无效: $name" }
  $trusted = $signature.Status -eq 'Valid'
  $hasTimestamp = $null -ne $signature.TimeStamperCertificate
  if ($RequireTrusted -and -not $trusted) { throw "证书链不受信任: $name ($($signature.Status))" }
  if (-not $AllowNoTimestamp -and -not $hasTimestamp) { throw "缺少时间戳: $name" }
  $results += @{ file = $name; signaturePresent = $true; trusted = $trusted; status = [string]$signature.Status; hasTimestamp = $hasTimestamp; subject = $signature.SignerCertificate.Subject; issuer = $signature.SignerCertificate.Issuer }
}
$results | ConvertTo-Json -Depth 5
