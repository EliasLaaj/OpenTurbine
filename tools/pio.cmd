@echo off
setlocal
set "WORKSPACE_PIO=%~dp0..\..\.pio-core\penv\Scripts\platformio.exe"
set "USER_PIO=%USERPROFILE%\.platformio\penv\Scripts\platformio.exe"
if exist "%USER_PIO%" goto user_pio
if exist "%WORKSPACE_PIO%" goto workspace_pio
echo No healthy PlatformIO virtual-environment executable was found. 1>&2
exit /b 1

:user_pio
"%USER_PIO%" %*
exit /b %ERRORLEVEL%

:workspace_pio
"%WORKSPACE_PIO%" %*
exit /b %ERRORLEVEL%
