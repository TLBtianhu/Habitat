# Habitat 设置中心：随时修改配置；保存与生效状态分离，secret 仅在本机内存中使用。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ControlBaseUrl,
  [Parameter(Mandatory = $true)][string]$OwnerToken
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:OwnerToken = $OwnerToken
$script:Settings = $null

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Habitat 设置中心'
$form.Size = New-Object System.Drawing.Size(780, 700)
$form.StartPosition = 'CenterParent'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

function New-Label([string]$Text, [int]$X, [int]$Y, [int]$Width = 150) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, 26)
  $form.Controls.Add($label)
  return $label
}
function New-Input([int]$X, [int]$Y, [int]$Width = 540, [bool]$Secret = $false) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($X, $Y)
  $box.Size = New-Object System.Drawing.Size($Width, 28)
  $box.UseSystemPasswordChar = $Secret
  $form.Controls.Add($box)
  return $box
}
function New-Checkbox([string]$Text, [int]$X, [int]$Y) {
  $box = New-Object System.Windows.Forms.CheckBox
  $box.Text = $Text
  $box.Location = New-Object System.Drawing.Point($X, $Y)
  $box.AutoSize = $true
  $form.Controls.Add($box)
  return $box
}

$title = New-Label '配置可随时修改；保存后由独立实例 supervisor 应用。' 25 18 700
$title.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$agentBox = New-Checkbox '启用 AgentLoop（需要有效 LLM 配置）' 25 55

$null = New-Label 'LLM Base URL' 25 95
$baseUrlBox = New-Input 180 92
$null = New-Label 'Model' 25 133
$modelBox = New-Input 180 130
$null = New-Label 'API key（留空不改）' 25 171
$apiKeyBox = New-Input 180 168 540 $true

$qqBox = New-Checkbox '启用 QQ（启用前验证真实后端登录）' 25 215
$null = New-Label 'QQ WS URL' 25 255
$qqWsBox = New-Input 180 252
$null = New-Label 'QQ HTTP URL' 25 293
$qqHttpBox = New-Input 180 290
$null = New-Label 'NapCat token（留空不改）' 25 331
$qqTokenBox = New-Input 180 328 540 $true

$biliBox = New-Checkbox '启用 B站只读弹幕（不启动公开推流）' 25 375
$null = New-Label 'B站房间号' 25 415
$biliRoomBox = New-Input 180 412
$null = New-Label 'B站 cookie（留空不改）' 25 453
$biliCookieBox = New-Input 180 450 540 $true

$mcBox = New-Checkbox '启用 MC（需先完成世界连接配置）' 25 495
$mcBox.Enabled = $false

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = '校验并保存设置'
$saveButton.Location = New-Object System.Drawing.Point(25, 540)
$saveButton.Size = New-Object System.Drawing.Size(160, 38)
$form.Controls.Add($saveButton)
$reapplyButton = New-Object System.Windows.Forms.Button
$reapplyButton.Text = '重新应用已保存配置'
$reapplyButton.Location = New-Object System.Drawing.Point(200, 540)
$reapplyButton.Size = New-Object System.Drawing.Size(190, 38)
$form.Controls.Add($reapplyButton)
$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = '重新读取'
$refreshButton.Location = New-Object System.Drawing.Point(405, 540)
$refreshButton.Size = New-Object System.Drawing.Size(120, 38)
$form.Controls.Add($refreshButton)
$statusLabel = New-Label '正在读取设置…' 25 595 700
$statusLabel.Size = New-Object System.Drawing.Size(700, 55)

function Invoke-SettingsApi([string]$Method, [string]$Path, $Body = $null) {
  $params = @{
    Method = $Method
    Uri = "$ControlBaseUrl$Path"
    Headers = @{ Authorization = "Bearer $($script:OwnerToken)" }
    TimeoutSec = 20
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = $Body | ConvertTo-Json -Depth 8 -Compress
  }
  return Invoke-RestMethod @params
}
function Update-ApplyStatus {
  try {
    $current = Invoke-SettingsApi 'GET' '/settings'
    $required = @($current.apply.configurationRequired) -join ', '
    $statusLabel.Text = "生效状态：$($current.apply.state) · 配置修订：$($current.apply.settingsRevision)`r`n待配置：$required"
    return $current
  } catch {
    $statusLabel.Text = '读取生效状态失败：' + $_.Exception.Message
    return $null
  }
}
function Read-Settings {
  try {
    $script:Settings = Invoke-SettingsApi 'GET' '/settings'
    $agentBox.Checked = $script:Settings.agent
    $baseUrlBox.Text = $script:Settings.llm.baseUrl
    $modelBox.Text = $script:Settings.llm.model
    $qqBox.Checked = $script:Settings.applications.qq
    $qqWsBox.Text = $script:Settings.connections.qq.wsUrl
    $qqHttpBox.Text = $script:Settings.connections.qq.httpUrl
    $biliBox.Checked = $script:Settings.applications.bilibili
    $biliRoomBox.Text = [string]$script:Settings.connections.bilibili.roomId
    $mcBox.Checked = $false
    Update-ApplyStatus | Out-Null
  } catch {
    $statusLabel.Text = '读取设置失败：' + $_.Exception.Message
  }
}
function Save-Settings {
  $roomId = 0
  if ($biliRoomBox.Text.Trim() -and -not [int]::TryParse($biliRoomBox.Text.Trim(), [ref]$roomId)) {
    $statusLabel.Text = 'B站房间号必须是正整数'
    return
  }
  $body = @{
    agent = $agentBox.Checked
    applications = @{ qq = $qqBox.Checked; bilibili = $biliBox.Checked; mc = $false }
    connections = @{
      qq = @{ wsUrl = $qqWsBox.Text.Trim(); httpUrl = $qqHttpBox.Text.Trim() }
      bilibili = @{ roomId = $roomId }
    }
  }
  if ($qqTokenBox.Text) { $body.connections.qq.token = $qqTokenBox.Text }
  if ($biliCookieBox.Text) { $body.connections.bilibili.cookie = $biliCookieBox.Text }
  if ($script:Settings.llm.configured -or $baseUrlBox.Text.Trim() -or $modelBox.Text.Trim() -or $apiKeyBox.Text) {
    $body.llm = @{ baseUrl = $baseUrlBox.Text.Trim(); model = $modelBox.Text.Trim() }
    if ($apiKeyBox.Text) { $body.llm.apiKey = $apiKeyBox.Text }
  }
  $statusLabel.Text = '正在校验连接并保存；校验失败不会写入配置…'
  $form.Refresh()
  try {
    $null = Invoke-SettingsApi 'POST' '/settings' $body
    $apiKeyBox.Clear(); $qqTokenBox.Clear(); $biliCookieBox.Clear()
    $statusLabel.Text = '已保存，等待 supervisor 应用…'
    Update-ApplyStatus | Out-Null
  } catch {
    $statusLabel.Text = '设置未保存：' + $_.Exception.Message
  }
}
$saveButton.Add_Click({ Save-Settings })
$reapplyButton.Add_Click({
  try {
    $null = Invoke-SettingsApi 'POST' '/settings/reapply' @{}
    $statusLabel.Text = '已请求重新应用已保存配置…'
    Update-ApplyStatus | Out-Null
  } catch { $statusLabel.Text = '重新应用失败：' + $_.Exception.Message }
})
$refreshButton.Add_Click({ Read-Settings })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-ApplyStatus | Out-Null })
$timer.Start()
$form.Add_FormClosed({
  $timer.Stop()
  $apiKeyBox.Clear(); $qqTokenBox.Clear(); $biliCookieBox.Clear()
  $script:OwnerToken = ''
})
Read-Settings
[void]$form.ShowDialog()
