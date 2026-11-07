@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title OranMatik Klon - Veri Guncelleme

where node >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Node.js bulunamadi.
  pause
  exit /b 1
)

echo.
echo  Arsivden yeni sezon verileri indiriliyor (birkac dakika surer)...
echo.
node tools\fetch.js
if errorlevel 1 (
  echo  [UYARI] Indirme sirasinda hata olustu, mevcut dosyalarla devam ediliyor.
)

echo.
echo  Veritabani yeniden derleniyor...
echo.
node tools\build.js

echo.
echo  Bitti. Uygulamayi "baslat.cmd" ile acabilirsin.
pause
