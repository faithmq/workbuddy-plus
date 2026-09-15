#!/bin/bash
# WorkBuddy 自动化「分钟/秒级」注入：退出 → 带 NODE_OPTIONS 重启 → 检查日志
set -u

HOOK="/Users/Rico/.workbuddy/hooks/automation-seconds-inject.js"
RENDERER="/Users/Rico/.workbuddy/hooks/inject-renderer.js"
LOG="/tmp/wb-inject-hook.log"
RLOG="/tmp/wb-inject-renderer.log"
BIN="/Applications/WorkBuddy.app/Contents/MacOS/Electron"

echo "[1/4] 清空旧日志"
rm -f "$LOG" "$RLOG" /tmp/wb-selftest.log /tmp/wb-probe.log /tmp/wb-filereq.log

echo "[2/4] 退出 WorkBuddy..."
osascript -e 'quit app "WorkBuddy"' 2>/dev/null || true
sleep 5
if pgrep -f "WorkBuddy.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "      仍有残留进程，强制结束..."
  pkill -f "WorkBuddy.app/Contents/MacOS" 2>/dev/null || true
  sleep 3
fi

echo "[3/4] 带 NODE_OPTIONS 启动 WorkBuddy..."
NODE_OPTIONS="--require=$HOOK --require=$RENDERER" nohup "$BIN" >/dev/null 2>&1 &
echo "      已启动 (PID $!)"

echo "[4/4] 等待加载 (10s)..."
sleep 10

echo
echo "===== 主进程(daemon)注入日志 ====="
if [ -f "$LOG" ]; then cat "$LOG"; else echo "❌ 未找到 $LOG"; fi
echo
echo "===== renderer 注入日志 ====="
if [ -f "$RLOG" ]; then cat "$RLOG"; else echo "❌ 未找到 $RLOG"; fi
