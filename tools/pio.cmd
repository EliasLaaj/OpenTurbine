@echo off
setlocal
set "WORKSPACE_PIO=%~dp0..\..\.pio-core\penv\Scripts\platformio.exe"
set "USER_PIO=%USERPROFILE%\.platformio\penv\Scripts\platformio.exe"
if exist "%USER_PIO%" (
  "%USER_PIO%" %*
  exit /b %ERRORLEVEL%
)
if exist "%WORKSPACE_PIO%" (
  "%WORKSPACE_PIO%" %*
  exit /b %ERRORLEVEL%
)
echo No healthy PlatformIO virtual-environment executable was found. 1>&2
exit /b 1
