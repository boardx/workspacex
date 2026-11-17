@echo off
cd /d "%~dp0\..\.."
call pnpm aidt:local build %*
exit /b %errorlevel%
