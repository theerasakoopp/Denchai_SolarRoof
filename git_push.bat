@echo off
title Denchai SolarRoof - Git Sync & Deploy to GitHub
echo ========================================================
echo    Denchai SolarRoof: 1-Click Sync & Deploy to GitHub
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0push.ps1"
pause
