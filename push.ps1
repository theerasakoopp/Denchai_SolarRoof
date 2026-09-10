# Denchai_SolarRoof Git Sync & Deploy Script
param (
    [string]$msg = "Deploy Den Chai SolarRoof WebGIS Dashboard ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"
)

$gitPath = "C:\Users\theerasak\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd\git.exe"
if (-not (Test-Path $gitPath)) {
    $gitPath = "git"
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " 🚀 Denchai_SolarRoof: Git Sync & Deploy" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Using Git: $gitPath"

Write-Host "1. Staging changes..." -ForegroundColor Gray
& $gitPath add -A

Write-Host "2. Committing..." -ForegroundColor Gray
& $gitPath commit -m "$msg"

Write-Host "3. Pushing to GitHub (main branch)..." -ForegroundColor Cyan
& $gitPath push origin main

Write-Host "[SUCCESS] Pushed to https://github.com/theerasakoopp/Denchai_SolarRoof" -ForegroundColor Green
