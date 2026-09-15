/**
 * 探测 hook 2：验证能否观察主窗口 renderer 的 file:// chunk 加载请求
 * 用 session.webRequest.onBeforeRequest 记录所有 file:// 请求。
 */
'use strict';

const fs = require('fs');
const LOG = '/tmp/wb-filereq.log';

function log(m) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (_) {}
}

let hooked = false;
function tryHook() {
  if (hooked) return;
  try {
    const electron = require('electron');
    const { app, session } = electron;
    if (!app || typeof app.whenReady !== 'function') return;
    app.whenReady().then(() => {
      try {
        const ses = session.defaultSession;
        ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
          const u = details.url;
          // 只记录 renderer 相关的 js 文件
          if (/renderer|automation|index.*\.js|assets/.test(u)) {
            log('[FILE] ' + details.resourceType + ' ' + u);
          }
          callback({});
        });
        log('[PROBE2] file:// webRequest 钩子已挂载');
      } catch (e) {
        log('[PROBE2] webRequest 挂载失败: ' + (e && e.stack || e));
      }
    });
    hooked = true;
  } catch (e) {
    log('[PROBE2] require electron 失败: ' + e.message);
  }
}

tryHook();
setTimeout(tryHook, 3000);

log('[PROBE2] 探测 hook 2 已加载, argv[1]=' + (process.argv[1] || ''));
