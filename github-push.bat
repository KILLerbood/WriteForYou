@echo off
chcp 65001 >nul
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (echo Git مش متسطّب & exit /b 2)
if not exist .git (git init -b main & git remote add origin https://github.com/KILLerbood/WriteForYou.git)
git add -A
git -c user.name="WriteForYou" -c user.email="noreply@writeforyou.local" commit -m "update %date% %time%" >nul 2>nul
git push -u origin main 2>&1
exit /b %errorlevel%
