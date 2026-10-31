@echo off
setlocal
cd /d "%~dp0"
start "MATHORO - servidor" cmd /k "cd /d ""%~dp0"" && python server.py"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/index.html"
endlocal
