# Start the Trishuli Flood & Landslide Early Warning System (backend, simulator, dashboard)
# Usage: .\start_all.ps1            (dashboard on port 5173)
#        .\start_all.ps1 -FrontendPort 5180
param([int]$FrontendPort = 5173)
Set-Location $PSScriptRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " TRISHULI RIVER BASIN FLOOD & LANDSLIDE EARLY WARNING SYSTEM" -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Write-Host "No .env found. Copy .env.example to .env and set JWT_SECRET, DEFAULT_OPERATOR_PASSWORD and a private MQTT topic prefix." -ForegroundColor Red
    exit 1
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Host "Python is not installed or not on PATH." -ForegroundColor Red; exit 1 }
if (-not (Test-Path "frontend\node_modules")) { Write-Host "Run 'npm install' in .\frontend first." -ForegroundColor Red; exit 1 }

Write-Host "[1/3] Backend      -> http://127.0.0.1:8000" -ForegroundColor Green
Start-Process powershell -WorkingDirectory $PSScriptRoot -ArgumentList "-NoExit", "-Command", "python backend\run.py"
Start-Sleep -Seconds 3

Write-Host "[2/3] Simulator    -> MQTT" -ForegroundColor Green
Start-Process powershell -WorkingDirectory $PSScriptRoot -ArgumentList "-NoExit", "-Command", "python -u sensor-sim\simulator.py"
Start-Sleep -Seconds 2

Write-Host "[3/3] Dashboard    -> http://localhost:$FrontendPort" -ForegroundColor Green
Start-Process powershell -WorkingDirectory (Join-Path $PSScriptRoot "frontend") -ArgumentList "-NoExit", "-Command", "npm run dev -- --port $FrontendPort --strictPort"

Write-Host "`nOpen http://localhost:$FrontendPort  (dashboard: /app/monitor, public bulletin: /bulletin)" -ForegroundColor Yellow
Write-Host "Sign in as 'operator' with DEFAULT_OPERATOR_PASSWORD from .env to acknowledge alerts or run the demo." -ForegroundColor Green
Write-Host "Frontend dev port must match ALLOWED_ORIGINS in .env." -ForegroundColor DarkGray
