# Starts ConqChat for a live demonstration on this laptop.
#   Right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File tools\start_demo.ps1
# Opens two windows: the server (web :8000 + TCP chat :5000, DEBUG logging) and a live server log.
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# This laptop's IP address on the current Wi-Fi / hotspot
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { $ip = "127.0.0.1" }

New-Item -ItemType Directory -Force logs | Out-Null
if (-not (Test-Path logs\server.log)) { New-Item -ItemType File logs\server.log | Out-Null }

# Window 1: the server, listening on all interfaces so the phone can connect
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
`$Host.UI.RawUI.WindowTitle = 'ConqChat SERVER'
cd '$root'; .venv\Scripts\activate
`$env:LOG_LEVEL = 'DEBUG'
uvicorn app.main:app --host 0.0.0.0 --port 8000
"@

# Window 2: the live connection log
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
`$Host.UI.RawUI.WindowTitle = 'ConqChat LOG'
cd '$root'; Get-Content logs\server.log -Wait -Tail 3
"@

Start-Sleep -Seconds 4
Write-Host ""
Write-Host "  ConqChat is running on this laptop" -ForegroundColor Green
Write-Host "  Phone browser:      http://${ip}:8000" -ForegroundColor Cyan
Write-Host "  Terminal client:    python client\chat_client.py --host $ip --port 5000" -ForegroundColor Cyan
Write-Host "  Framing demo:       python tools\framing_demo.py --host $ip" -ForegroundColor Cyan
Write-Host "  Listening sockets:  netstat -ano | findstr LISTENING | findstr `":5000 :8000`"" -ForegroundColor Cyan
Write-Host ""
