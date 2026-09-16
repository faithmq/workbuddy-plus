/* WBP-BOOTSTRAP-START WorkBuddy Plus 注入引导（删除本注释块之间的内容即可完全恢复原状） */
// 为什么放在这里：Windows 上打包版 Electron 会忽略 NODE_OPTIONS（mac 不会），
// 无法用 `--require` 注入主进程/daemon。而本文件
//   <安装目录>\resources\app.asar.unpacked\node_modules\better-sqlite3\lib\index.js
// 是磁盘上的真实文件（unpacked 目录不在 app.asar 完整性校验范围内），
// 且 GUI 主进程与 daemon 子进程在启动早期都会 require 它，
// 因此把它作为注入入口，等价于 mac 上的 NODE_OPTIONS="--require=..."。
try {
  const _os = require('os');
  const _fs = require('fs');
  const _path = require('path');
  const _hooksDir = _path.join(_os.homedir(), '.workbuddy', 'hooks');
  const _mark = (m) => {
    try {
      _fs.appendFileSync(_path.join(_os.tmpdir(), 'wb-bootstrap.log'),
        '[' + new Date().toISOString() + '] ' + m + '\n');
    } catch (_) { /* 日志失败不阻断 */ }
  };
  _mark('引导已加载 pid=' + process.pid + ' type=' + (process.type || 'node'));
  // automation-seconds-inject.js：放开 RRULE 的 MINUTELY / SECONDLY（主进程 + daemon）
  try {
    require(_path.join(_hooksDir, 'automation-seconds-inject.js'));
  } catch (e) {
    _mark('加载 automation-seconds-inject.js 失败: ' + ((e && e.message) || e));
  }
  // inject-renderer.js：渲染进程 UI 注入（仅在 Electron 主进程生效，daemon 里会自动跳过）
  try {
    require(_path.join(_hooksDir, 'inject-renderer.js'));
  } catch (e) {
    _mark('加载 inject-renderer.js 失败: ' + ((e && e.message) || e));
  }
} catch (e) { /* 引导失败不阻断 WorkBuddy 启动 */ }
/* WBP-BOOTSTRAP-END */
