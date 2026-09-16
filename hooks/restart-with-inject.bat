@echo off
REM WorkBuddy 自动化「分钟/秒级」注入：退出 → 带 NODE_OPTIONS 重启 → 检查日志
setlocal enabledelayedexpansion

set "HOOKS_DIR=%USERPROFILE%\.workbuddy\hooks"
set "HOOK=%HOOKS_DIR%\automation-seconds-inject.js"
set "RENDERER=%HOOKS_DIR%\inject-renderer.js"
set "LOG=%TEMP%\wb-inject-hook.log"
set "RLOG=%TEMP%\wb-inject-renderer.log"

REM ── 探测 WorkBuddy 安装路径与可执行文件 ──
set "WB_EXE="
for %%D in (
  "%LOCALAPPDATA%\Programs\WorkBuddy"
  "%LOCALAPPDATA%\Programs\workbuddy"
  "%PROGRAMFILES%\WorkBuddy"
) do (
  if not defined WB_EXE (
    for %%E in (WorkBuddy.exe Electron.exe workbuddy.exe) do (
      if exist "%%~D\%%E" set "WB_EXE=%%~D\%%E"
    )
  )
)

if not defined WB_EXE (
  echo [错误] 未找到 WorkBuddy 可执行文件
  pause
  exit /b 1
)

echo [1/4] 清空旧日志
del "%LOG%" "%RLOG%" 2>nul

echo [2/4] 退出 WorkBuddy...
taskkill /IM WorkBuddy.exe /F 2>nul
taskkill /IM Electron.exe /F 2>nul
timeout /t 3 /nobreak >nul

echo [3/4] 带 NODE_OPTIONS 启动 WorkBuddy...
set "NODE_OPTIONS=--require=%HOOK% --require=%RENDERER%"
start "" "%WB_EXE%"

echo [4/4] 等待加载 (10s)...
timeout /t 10 /nobreak >nul

echo.
echo ===== 主进程(daemon)注入日志 =====
if exist "%LOG%" (type "%LOG%") else (echo 未找到 %LOG%)

echo.
echo ===== renderer 注入日志 =====
if exist "%RLOG%" (type "%RLOG%") else (echo 未找到 %RLOG%)

echo.
pause
