@echo off
chcp 65001 >NUL
cd /d "%~dp0"
(
git --version || (echo Git not installed & exit /b 2)
if not exist .git (git init -b main & git remote add origin https://github.com/KILLerbood/WriteForYou.git)
echo --- gitignore:
type .gitignore
echo --- check-ignore:
git check-ignore -v audio jobs data inbox
echo --- add:
git add -A -f
git status --short
git -c user.name="WriteForYou" -c user.email="noreply@writeforyou.local" commit -m "update %date% %time%"
git push -u origin main
echo EXIT=%errorlevel%
) > push-result.txt 2>&1
