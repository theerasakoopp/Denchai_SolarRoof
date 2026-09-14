@echo off
title Denchai SolarRoof - WebGIS Local Server (Port 8081)
echo ========================================================
echo    UAV-SolarNet: Denchai Smart SolarRoof WebGIS
echo    Local Server: http://127.0.0.1:8081
echo ========================================================
echo Starting local web server on port 8081...
start http://127.0.0.1:8081
python -m http.server 8081
pause
