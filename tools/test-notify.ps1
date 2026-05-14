/**
 * CCTM 通知测试脚本 - PowerShell 版本
 *
 * 功能：向 CCTM 应用发送测试通知
 *
 * 用法: .\test-notify.ps1 [-Type] <string> [-TerminalId] <string>
 *
 * 示例:
 *   .\test-notify.ps1                    # 默认发送 auth_required 通知
 *   .\test-notify.ps1 -Type error        # 发送 error 通知
 *   .\test-notify.ps1 -Type session_ended -TerminalId "term-123"
 */

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('auth_required', 'session_ended', 'error')]
    [string]$Type = 'auth_required',

    [Parameter(Mandatory=$false)]
    [string]$TerminalId = $env:CCTM_TERMINAL_ID
)

# 配置
$PORT = 13452
$HOST = '127.0.0.1'
$URL = "http://${HOST}:${PORT}/notify"

# 检查终端 ID
if (-not $TerminalId) {
    Write-Host "错误: 未找到终端 ID" -ForegroundColor Red
    Write-Host ""
    Write-Host "此工具需要在 CCTM 终端内运行，或显式指定终端 ID。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "解决方法:" -ForegroundColor Yellow
    Write-Host "  1. 在 CCTM 终端内执行此命令（环境变量会自动设置）"
    Write-Host "  2. 使用 -TerminalId 参数指定终端 ID:"
    Write-Host "     .\test-notify.ps1 -Type $Type -TerminalId <terminal-id>"
    exit 1
}

# 构建请求数据
$body = @{
    terminalId = $TerminalId
    type = $Type
    timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
} | ConvertTo-Json

# 发送请求
try {
    Write-Host "正在发送通知..." -ForegroundColor Cyan
    Write-Host "  类型: $Type" -ForegroundColor Gray
    Write-Host "  终端: $TerminalId" -ForegroundColor Gray
    Write-Host "  URL: $URL" -ForegroundColor Gray
    Write-Host ""

    $response = Invoke-RestMethod -Uri $URL -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 2

    if ($response.success) {
        Write-Host "通知已发送成功!" -ForegroundColor Green
    }
}
catch [System.Net.WebException] {
    $err = $_
    if ($err.Exception.Response -eq $null) {
        Write-Host "错误: 无法连接到 CCTM 服务 (端口 $PORT)" -ForegroundColor Red
        Write-Host ""
        Write-Host "提示: 请确保 CCTM 应用正在运行" -ForegroundColor Yellow
    } else {
        Write-Host "错误: HTTP $($err.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
    exit 1
}
catch {
    Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
