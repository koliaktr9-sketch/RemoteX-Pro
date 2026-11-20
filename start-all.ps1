Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "              Starting RemoteX Pro Suite                " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$root = $PSScriptRoot
Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d `"$root\remotex-pro\apps\server`" && npm start"
Start-Sleep -Seconds 2

Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d `"$root\remotex-pro\apps\web`" && npm start"
Start-Sleep -Seconds 3

Start-Process "http://localhost:3000"

Write-Host "RemoteX Pro is up and running!" -ForegroundColor Green
Write-Host "Web Interface: http://localhost:3000" -ForegroundColor Yellow
Write-Host "API / Signaling: http://localhost:4000" -ForegroundColor Yellow
