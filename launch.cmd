@echo off
rem Opens the Investments Dashboard as its own standalone desktop app (Electron).
rem No browser, no Edge, no separate dev-server window.
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
