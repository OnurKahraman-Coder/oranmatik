@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title OranMatik - Test

where node >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Node.js bulunamadi.
  pause
  exit /b 1
)

node tools\test.js
echo.
pause
