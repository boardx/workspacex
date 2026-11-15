@echo off
cd /d "%~dp0\..\.."
call pnpm aidt:local health %*
exit /b %errorlevel%
