@echo off
REM WorkBuddy 自动化「分钟/秒级」注入：退出 → 带 NODE_OPTIONS 重启 → 检查日志
setlocal enabledelayedexpansion

set "HOOKS_DIR=%USERPROFILE%\.workbuddy\hooks"
set "HOOK=%HOOKS_DIR%\automation-seconds-inject.js"
set "RENDERER=%HOOKS_DIR%\inject-renderer.js"
set "LOG=%TEMP%\wb-inject-hook.log"
set "RLOG=%TEMP%\wb-inject-renderer.log"
set "RESTART_LOG=%TEMP%\wb-restart.log"

REM ── 开始记录重启日志 ──
echo [%date% %time%] ==== 重启脚本开始 ==== > "%RESTART_LOG%"

REM ── 1. 探测 WorkBuddy 安装路径 ──
echo [1/5] 探测 WorkBuddy 安装路径...
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
  echo [错误] 未找到 WorkBuddy 可执行文件 >> "%RESTART_LOG%"
  echo [错误] 未找到 WorkBuddy 可执行文件
  type "%RESTART_LOG%"
  pause
  exit /b 1
)
echo [OK] WorkBuddy 可执行文件：%WB_EXE% >> "%RESTART_LOG%"

REM ── 2. 检查注入脚本是否就绪 ──
echo [2/5] 检查注入脚本...
if not exist "%HOOK%" (
  echo [错误] 主进程注入脚本缺失：%HOOK% >> "%RESTART_LOG%"
  echo [错误] 主进程注入脚本缺失
  type "%RESTART_LOG%"
  pause
  exit /b 1
)
if not exist "%RENDERER%" (
  echo [错误] 渲染进程注入脚本缺失：%RENDERER% >> "%RESTART_LOG%"
  echo [错误] 渲染进程注入脚本缺失
  type "%RESTART_LOG%"
  pause
  exit /b 1
)
echo [OK] 注入脚本就绪：%HOOK% / %RENDERER% >> "%RESTART_LOG%"

REM ── 3. 清空旧日志 ──
echo [3/5] 清空旧日志...
del "%LOG%" "%RLOG%" 2>nul

REM ── 4. 退出 WorkBuddy ──
echo [4/5] 退出 WorkBuddy...
taskkill /IM WorkBuddy.exe /F >> "%RESTART_LOG%" 2>&1
taskkill /IM Electron.exe /F >> "%RESTART_LOG%" 2>&1
timeout /t 3 /nobreak >nul

REM ── 5. 带 NODE_OPTIONS 唤起 WorkBuddy ──
echo [5/5] 带 NODE_OPTIONS 启动 WorkBuddy...
set "NODE_OPTIONS=--require=%HOOK% --require=%RENDERER%"
echo [INFO] NODE_OPTIONS=%NODE_OPTIONS% >> "%RESTART_LOG%"
start "" "%WB_EXE%"
echo [OK] 已启动 WorkBuddy >> "%RESTART_LOG%"

echo [等待] 等待加载 (10s)...
timeout /t 10 /nobreak >nul

echo.
echo ===== 重启日志（%RESTART_LOG%）=====
type "%RESTART_LOG%"

echo.
echo ===== 主进程(daemon)注入日志 =====
if exist "%LOG%" (type "%LOG%") else (echo 未找到 %LOG% —— 主进程注入未生效)

echo.
echo ===== renderer 注入日志 =====
if exist "%RLOG%" (type "%RLOG%") else (echo 未找到 %RLOG% —— 渲染进程注入未生效)

echo.
pause
