# CCTM 任务栏闪烁测试脚本

# 生成一个随机的 UUID 作为测试终端 ID
$testId = [guid]::NewGuid().ToString()

Write-Host "测试终端 ID: $testId" -ForegroundColor Cyan
Write-Host ""
Write-Host "测试场景:" -ForegroundColor Yellow
Write-Host "1. 请先切换到其他应用（让 CCTM 窗口失去焦点）"
Write-Host "2. 按任意键发送通知..."
Write-Host ""

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# 发送通知
Invoke-RestMethod -Uri "http://127.0.0.1:13452/notify" -Method Post -Body "{""terminalId"":""$testId"",""type"":""auth_required""}" -ContentType "application/json"

Write-Host ""
Write-Host "通知已发送！" -ForegroundColor Green
Write-Host "预期: 任务栏图标应该开始闪烁" -ForegroundColor Yellow
Write-Host ""
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
