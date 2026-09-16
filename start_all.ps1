# Start Flood/Landslide Early Warning & Alert Routing System
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " TRISHULI RIVER BASIN FLOOD & LANDSLIDE EARLY WARNING SYSTEM     " -ForegroundColor Yellow
Write-Host " Final Year Project (8th Semester) Architecture & Viva Demo Stack" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# Check Python and Node
Write-Host "[1/3] Launching FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "python backend/run.py"

Start-Sleep -Seconds 2

Write-Host "[2/3] Launching Sensor Simulator (MQTT -> HiveMQ)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "python sensor-sim/simulator.py"

Start-Sleep -Seconds 2

Write-Host "[3/3] Launching React Operations Dashboard on http://localhost:5173..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host "`nAll 3 services launched in separate windows!" -ForegroundColor Cyan
Write-Host "Open your browser at: http://localhost:5173" -ForegroundColor Yellow
Write-Host "To inject a demo flood spike, use the dashboard button or run: python sensor-sim/trigger_spike.py" -ForegroundColor Green
