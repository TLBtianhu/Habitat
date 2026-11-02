# Habitat Windows 客户端：一个窗口完成 WSL 检测、启停与异常恢复。
[CmdletBinding()]
param([string]$Distro = 'Ubuntu')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Import-Module (Join-Path $PSScriptRoot 'lifecycle.psm1') -Force

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Habitat 控制台'
$form.Size = New-Object System.Drawing.Size(720, 450)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Habitat 控制台'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(24, 20)
$form.Controls.Add($title)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = '正在读取状态…'
$statusLabel.AutoSize = $false
$statusLabel.Size = New-Object System.Drawing.Size(650, 90)
$statusLabel.Location = New-Object System.Drawing.Point(28, 75)
$form.Controls.Add($statusLabel)

$environmentLabel = New-Object System.Windows.Forms.Label
$environmentLabel.Text = "运行环境：WSL / $Distro（由 Windows 客户端管理）"
$environmentLabel.AutoSize = $true
$environmentLabel.Location = New-Object System.Drawing.Point(30, 170)
$form.Controls.Add($environmentLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '启动 Habitat'
$startButton.Size = New-Object System.Drawing.Size(145, 40)
$startButton.Location = New-Object System.Drawing.Point(30, 210)
$form.Controls.Add($startButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = '停止 Habitat'
$stopButton.Size = New-Object System.Drawing.Size(145, 40)
$stopButton.Location = New-Object System.Drawing.Point(190, 210)
$form.Controls.Add($stopButton)

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = '刷新状态'
$refreshButton.Size = New-Object System.Drawing.Size(130, 40)
$refreshButton.Location = New-Object System.Drawing.Point(350, 210)
$form.Controls.Add($refreshButton)

$recoverButton = New-Object System.Windows.Forms.Button
$recoverButton.Text = '异常恢复'
$recoverButton.Size = New-Object System.Drawing.Size(130, 40)
$recoverButton.Location = New-Object System.Drawing.Point(495, 210)
$form.Controls.Add($recoverButton)

$tokenLabel = New-Object System.Windows.Forms.Label
$tokenLabel.Text = 'Owner token（仅本次恢复使用，不保存）'
$tokenLabel.AutoSize = $true
$tokenLabel.Location = New-Object System.Drawing.Point(30, 275)
$form.Controls.Add($tokenLabel)

$tokenBox = New-Object System.Windows.Forms.TextBox
$tokenBox.Size = New-Object System.Drawing.Size(450, 32)
$tokenBox.Location = New-Object System.Drawing.Point(30, 305)
$tokenBox.UseSystemPasswordChar = $true
$form.Controls.Add($tokenBox)

$noteLabel = New-Object System.Windows.Forms.Label
$noteLabel.Text = '停止 Habitat 不关闭整个 WSL；关闭此窗口不会停止 Habitat。'
$noteLabel.AutoSize = $true
$noteLabel.Location = New-Object System.Drawing.Point(30, 355)
$form.Controls.Add($noteLabel)

$script:KeepaliveProcess = $null
$script:Busy = $false

function Set-Busy([bool]$Busy, [string]$Text) {
  $script:Busy = $Busy
  $statusLabel.Text = $Text
  $startButton.Enabled = -not $Busy
  $stopButton.Enabled = -not $Busy
  $refreshButton.Enabled = -not $Busy
  $recoverButton.Enabled = -not $Busy
  $form.Refresh()
}

function Refresh-Status {
  if ($script:Busy) { return }
  try {
    $status = Get-HabitatLifecycleStatus
    $recovery = if ($status.recoveryRequired) { '需要异常恢复' } else { '无待恢复项' }
    $text = "状态：$($status.state)`r`n启动次数：$($status.bootId) · $recovery"
    if ($status.lastShutdownAbnormal) { $text += "`r`n上次为异常中断" }
    try {
      $presence = Invoke-RestMethod -Uri 'http://127.0.0.1:9240/presence' -TimeoutSec 3
      $text += "`r`n场所：$($presence.aggregate)"
    } catch { $text += "`r`n场所：unknown" }
    $statusLabel.Text = $text
    $recoverButton.Enabled = $status.recoveryRequired -and -not $script:Busy
  } catch {
    $statusLabel.Text = '状态：无法连接 Habitat 服务' + "`r`n" + '可点击“启动 Habitat”检测并启动 WSL'
    $recoverButton.Enabled = $false
  }
}

$startButton.Add_Click({
  Set-Busy $true '正在检测并启动 WSL / Habitat…'
  try {
    $result = Start-HabitatLifecycle -Distro $Distro
    $script:KeepaliveProcess = $result.keepaliveProcess
    Set-Busy $false 'Habitat 已启动'
    Refresh-Status
  } catch {
    Set-Busy $false ("启动失败：" + $_.Exception.Message)
  }
})

$stopButton.Add_Click({
  Set-Busy $true '正在停止 Habitat（不会关闭整个 WSL）…'
  try {
    Stop-HabitatLifecycle -Distro $Distro | Out-Null
    if ($script:KeepaliveProcess -and -not $script:KeepaliveProcess.HasExited) {
      Stop-Process -Id $script:KeepaliveProcess.Id -ErrorAction SilentlyContinue
    }
    $script:KeepaliveProcess = $null
    Set-Busy $false 'Habitat 已停止；其他 WSL 工作未受影响'
    Refresh-Status
  } catch {
    Set-Busy $false ("停止未完成：" + $_.Exception.Message)
  }
})

$refreshButton.Add_Click({ Refresh-Status })

$recoverButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($tokenBox.Text)) {
    [System.Windows.Forms.MessageBox]::Show('异常恢复需要 owner token。token 只用于本次请求，不会保存。', '需要 owner token') | Out-Null
    return
  }
  Set-Busy $true '正在只读核对异常恢复证据，不会重放动作…'
  try {
    $result = Invoke-HabitatRecovery -Token $tokenBox.Text
    $tokenBox.Clear()
    Set-Busy $false "恢复核对完成：pending $($result.pendingWrites.PSObject.Properties.Count) 类状态"
    Refresh-Status
  } catch {
    $tokenBox.Clear()
    Set-Busy $false ("恢复失败：" + $_.Exception.Message)
  }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Refresh-Status })
$timer.Start()
$form.Add_FormClosed({ $timer.Stop() })
Refresh-Status
[void]$form.ShowDialog()
