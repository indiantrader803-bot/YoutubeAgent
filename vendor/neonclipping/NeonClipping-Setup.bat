@echo off
setlocal
title NeonClipping Setup
echo.
echo   NeonClipping setup shuru ho raha hai (internet chahiye)...
echo   Ye file sirf install.ps1 laakar chalati hai. Padhna ho to Notepad mein kholo.
echo.
set "F=%~dp0install.ps1"
if exist "%F%" goto :run
set "U=https://raw.githubusercontent.com/iamajmeena/neonclipping/main/install.ps1"
set "F=%TEMP%\neonclipping-install.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing '%U%' -OutFile '%F%' } catch { Write-Host ('Download failed: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 goto :fail
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%F%"
goto :end
:fail
echo.
echo   Installer download nahi ho paya. Internet check karke dobara double-click karo.
:end
echo.
pause
