@echo off
chcp 65001 >nul
echo ============================================
echo  Card Export - 一键部署到 Obsidian 库
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
pause
