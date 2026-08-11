$ErrorActionPreference = 'SilentlyContinue'

# Local relay for Syzygy's toy MCP service. It is intended to run hidden at
# Windows sign-in and deliberately only starts missing processes.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$python = Join-Path $root '.venv\Scripts\python.exe'
$ngrok = 'C:\Users\lxr56\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe'

$toyServerRunning = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
if (-not $toyServerRunning -and (Test-Path $python)) {
    $toyCommand = 'set "TOY_BLE_ADDRESS=4D:F4:0E:D8:53:7D" && set "TOY_MCP_TOKEN=111111" && .venv\Scripts\python.exe tools\ble\toy_mcp_server.py'
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $toyCommand) -WorkingDirectory $root -WindowStyle Hidden
}

$ngrokRunning = Get-CimInstance Win32_Process -Filter "Name='ngrok.exe'" |
    Where-Object { $_.CommandLine -match 'http\s+8000' } |
    Select-Object -First 1
if (-not $ngrokRunning -and (Test-Path $ngrok)) {
    Start-Process -FilePath $ngrok -ArgumentList @('http', '8000', '--log=stdout') -WindowStyle Hidden
}
