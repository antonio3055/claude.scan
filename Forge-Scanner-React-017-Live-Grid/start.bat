@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer.
  echo Install it from https://nodejs.org ^(the LTS version^), then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo First time setup - installing the scanner. This only happens once and
  echo can take a minute or two. Please wait...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong installing the scanner. Scroll up to see the
    echo error, then double-click this file again to retry.
    echo.
    pause
    exit /b 1
  )
)

if not exist ".vercel\output" (
  echo.
  echo First time setup - building the scanner. This only happens once and
  echo can take a minute. Please wait...
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo Something went wrong building the scanner. Scroll up to see the
    echo error, then double-click this file again to retry.
    echo.
    pause
    exit /b 1
  )
)

rem Already running from an earlier double-click? Just open it, don't start
rem a second copy.
netstat -ano | findstr :8080 | findstr LISTENING >nul 2>nul
if not errorlevel 1 (
  echo The scanner is already running - opening it in your browser.
  start "" http://127.0.0.1:8080/
  goto :end
)

echo.
echo Starting the scanner...
start "" wscript.exe "%~dp0scripts\hidden-launch.vbs"

node scripts\wait-for-server.mjs
if errorlevel 1 (
  echo.
  echo The scanner did not start. Open server.log in this folder to see why,
  echo fix it, then double-click this file again.
  echo.
  pause
  exit /b 1
)

start "" http://127.0.0.1:8080/
echo.
echo The scanner is running and open in your browser. It keeps running in
echo the background - you can close this window right now.
echo.
echo To stop it later, double-click stop.bat.
echo.
timeout /t 4 /nobreak >nul

:end
endlocal
