@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title OranMatik Klon

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [HATA] Node.js bulunamadi.
  echo  https://nodejs.org adresinden LTS surumu kurup tekrar deneyin.
  echo.
  pause
  exit /b 1
)

if not exist "data\db.json" (
  echo  Veritabani bulunamadi, olusturuluyor...
  node tools\build.js
  if errorlevel 1 (
    echo  [HATA] Veritabani olusturulamadi.
    pause
    exit /b 1
  )
)

echo.
echo  OranMatik Klon baslatiliyor...
echo  Tarayici otomatik acilacak. Bu pencereyi KAPATMAYIN.
echo  Durdurmak icin: bu pencerede Ctrl+C ya da pencereyi kapat.
echo.
node server.js 5178 --open
pause
