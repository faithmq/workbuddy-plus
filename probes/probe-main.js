/**
 * 探测 hook：hook 主进程的 loadFile，记录加载路径与最终 URL
 * 用于定位运行时前端（12位hash）到底怎么 serve 的。
 */
'use strict';

const Module = require('module');
const fs = require('fs');
const LOG = '/tmp/wb-probe.log';

function log(m) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (_) {}
}

function patchMainIndex(source) {
  // 在 loadFile 调用处注入日志（记录路径 + 最终 URL）
  const old = 'this.win.loadFile(getRendererFilePath(), { query: queryKeys.length > 0 ? this.loadQuery : void 0 }).catch((error) => {';
  const neu = 'this.win.loadFile(getRendererFilePath(), { query: queryKeys.length > 0 ? this.loadQuery : void 0 }).then(() => { try { require("fs").appendFileSync("/tmp/wb-probe.log", "[PROBE] loadFile done: path=" + getRendererFilePath() + " finalUrl=" + this.win.webContents.getURL() + "\\n"); } catch(e){} }).catch((error) => {';
  const n = source.split(old).length - 1;
  if (n !== 1) {
    log('[PROBE] loadFile 目标命中 ' + n + ' 次（预期 1），跳过');
    return source;
  }
  log('[PROBE] loadFile 探针已注入');
  return source.split(old).join(neu);
}

const originalCompile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
  try {
    if (typeof content === 'string' && filename && /main[\\/]index\.js$/.test(filename)) {
      log('[PROBE] 拦截 main/index.js: ' + filename);
      content = patchMainIndex(content);
    }
  } catch (e) {
    log('[PROBE] patch 异常: ' + ((e && e.stack) || e));
  }
  return originalCompile.call(this, content, filename);
};

log('[PROBE] 探测 hook 已加载, argv[1]=' + (process.argv[1] || ''));
