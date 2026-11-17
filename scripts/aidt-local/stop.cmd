@echo off
cd /d "%~dp0\..\.."
call pnpm aidt:local stop %*
exit /b %errorlevel%
