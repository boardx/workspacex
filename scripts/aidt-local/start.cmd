@echo off
cd /d "%~dp0\..\.."
call pnpm aidt:local start %*
exit /b %errorlevel%
