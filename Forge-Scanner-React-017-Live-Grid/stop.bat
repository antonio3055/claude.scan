@echo off
setlocal enabledelayedexpansion

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>nul
  set FOUND=1
)

if "!FOUND!"=="1" (
  echo The scanner has been stopped.
) else (
  echo The scanner was not running.
)

echo.
pause
