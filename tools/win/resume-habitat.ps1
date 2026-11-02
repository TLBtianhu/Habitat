# Habitat 健康检查：只读，不启动 Outlet，不修改用户状态。
$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddSeconds(45)
$checks = @(
  @{ Name = 'control'; Url = 'http://127.0.0.1:9240/status' },
  @{ Name = 'desktop'; Url = 'http://127.0.0.1:9260/status' },
  @{ Name = 'voice'; Url = 'http://127.0.0.1:9270/health' },
  @{ Name = 'audio'; Url = 'http://127.0.0.1:9271/status' },
  @{ Name = 'outlet-supervisor'; Url = 'http://127.0.0.1:9272/status' }
)
$remaining = @($checks)
while ($remaining.Count -gt 0) {
  $next = @()
  foreach ($check in $remaining) {
    try {
      $null = Invoke-RestMethod -Uri $check.Url -TimeoutSec 3
      Write-Output ("ok: {0} {1}" -f $check.Name, $check.Url)
    } catch {
      $next += $check
    }
  }
  $remaining = $next
  if ($remaining.Count -eq 0) { break }
  if ((Get-Date) -ge $deadline) {
    $names = ($remaining | ForEach-Object { $_.Name }) -join ', '
    throw "Habitat health check failed: $names"
  }
  Start-Sleep -Milliseconds 800
}
Write-Output 'Habitat core is healthy; outlets remain stopped until explicitly opened.'
