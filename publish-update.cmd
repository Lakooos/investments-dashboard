@echo off
rem One-click publish: commits your changes and pushes to GitHub, which
rem auto-rebuilds and redeploys the live site via GitHub Actions (~1-2 min).
cd /d "%~dp0"

git add -A
git commit -m "Update %DATE% %TIME%"
git push

echo.
echo ============================================================
echo Pushed. The live site updates in ~1-2 minutes:
echo   https://lakooos.github.io/investments-dashboard/
echo Track the build at:
echo   https://github.com/Lakooos/investments-dashboard/actions
echo ============================================================
pause
