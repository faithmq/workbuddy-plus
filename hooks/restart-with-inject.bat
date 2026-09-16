@echo off
REM WorkBuddy Plus: install injection bootstrap -> restart WorkBuddy -> show logs
REM ASCII only. CRLF required.
REM Set WBP_NOPAUSE=1 (e.g. from the app UI) to skip the final "press any key".
setlocal

set "HOOKS_DIR=%USERPROFILE%\.workbuddy\hooks"
set "PS1=%HOOKS_DIR%\wbp-inject.ps1"
set "LOG=%TEMP%\wb-inject-hook.log"
set "RLOG=%TEMP%\wb-inject-renderer.log"
set "BLOG=%TEMP%\wb-bootstrap.log"
set "SLOG=%TEMP%\wb-selftest.log"
set "RESTART_LOG=%TEMP%\wb-restart.log"

echo [%date% %time%] ==== restart script start ==== > "%RESTART_LOG%"

REM 1. detect WorkBuddy install path
echo [1/5] detecting WorkBuddy path...
set "WB_EXE="
for %%D in (
  "%LOCALAPPDATA%\Programs\WorkBuddy"
  "%LOCALAPPDATA%\Programs\workbuddy"
  "%PROGRAMFILES%\WorkBuddy"
  "C:\WorkBuddy"
  "D:\WorkBuddy"
  "E:\WorkBuddy"
  "F:\WorkBuddy"
  "G:\WorkBuddy"
) do (
  if not defined WB_EXE (
    for %%E in (WorkBuddy.exe Electron.exe workbuddy.exe) do (
      if exist "%%~D\%%E" set "WB_EXE=%%~D\%%E"
    )
  )
)
if not defined WB_EXE (
  echo [ERROR] WorkBuddy.exe not found >> "%RESTART_LOG%"
  echo [ERROR] WorkBuddy.exe not found
  type "%RESTART_LOG%"
  if not defined WBP_NOPAUSE pause
  exit /b 1
)
echo [OK] WorkBuddy exe: %WB_EXE% >> "%RESTART_LOG%"

REM 2. check injection sources
echo [2/5] checking injection sources...
if not exist "%PS1%" (
  echo [ERROR] missing %PS1%
  if not defined WBP_NOPAUSE pause
  exit /b 1
)
if not exist "%HOOKS_DIR%\automation-seconds-inject.js" (
  echo [ERROR] missing automation-seconds-inject.js
  if not defined WBP_NOPAUSE pause
  exit /b 1
)
if not exist "%HOOKS_DIR%\inject-renderer.js" (
  echo [ERROR] missing inject-renderer.js
  if not defined WBP_NOPAUSE pause
  exit /b 1
)
if not exist "%HOOKS_DIR%\win-asar-bootstrap.js" (
  echo [ERROR] missing win-asar-bootstrap.js
  if not defined WBP_NOPAUSE pause
  exit /b 1
)

REM 3. install the asar-unpacked bootstrap (idempotent)
echo [3/5] installing injection bootstrap...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Action install >> "%RESTART_LOG%" 2>&1
echo [OK] bootstrap step done >> "%RESTART_LOG%"

REM 4. clear old logs and stop WorkBuddy
echo [4/5] stopping WorkBuddy...
del "%LOG%" "%RLOG%" "%BLOG%" "%SLOG%" 2>nul
taskkill /IM WorkBuddy.exe /F >> "%RESTART_LOG%" 2>&1
ping -n 4 127.0.0.1 >nul

REM 5. relaunch (bootstrap loads on every start, no env var needed)
echo [5/5] launching WorkBuddy...
start "" "%WB_EXE%"
echo [OK] WorkBuddy launched >> "%RESTART_LOG%"

echo [wait] waiting 20s...
ping -n 21 127.0.0.1 >nul

echo.
echo ===== restart log =====
type "%RESTART_LOG%"

echo.
echo ===== bootstrap log (should list browser + node) =====
if exist "%BLOG%" (type "%BLOG%") else (echo NOT FOUND %BLOG% - bootstrap did not run)

echo.
echo ===== daemon injection log =====
if exist "%LOG%" (type "%LOG%") else (echo NOT FOUND %LOG% - daemon hook not loaded)

echo.
echo ===== renderer injection log =====
if exist "%RLOG%" (type "%RLOG%") else (echo NOT FOUND %RLOG% - renderer hook not loaded)

echo.
if not defined WBP_NOPAUSE pause
