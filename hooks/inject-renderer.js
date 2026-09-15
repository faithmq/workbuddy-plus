/**
 * 方向二注入 hook：给 WorkBuddy 自动化面板的「间隔」配置加「时/分/秒」颗粒度。
 *
 * 原理：主窗口通过 file:// 加载 app.asar 里的 renderer chunk（automation-X2oiaBDA.js）。
 * 用 protocol.handle('file', ...) 拦截 file://：
 *   - 目标 chunk（automation-X2oiaBDA.js）→ 返回字符串替换后的内容（URL 不变，相对 import 正常）
 *   - 其他 file:// 请求 → 读取原始内容返回（Electron fs 支持 asar）
 */
'use strict';

const fs = require('fs');
const LOG = '/tmp/wb-inject-renderer.log';
const SRC = '/Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/assets/automation-X2oiaBDA.js';

function log(m) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (_) {}
}

// 6 处字符串替换
function patch(source) {
  const targets = [
    [
      'toIntervalRrule加unit',
      'function toIntervalRrule(hours, weekdays) {\n\treturn `FREQ=HOURLY;INTERVAL=${Math.max(1, hours)};BYDAY=${weekdays.join(",")}`;\n}',
      'function toIntervalRrule(hours, weekdays, unit) {\n\tconst _freq = unit === "second" ? "SECONDLY" : unit === "minute" ? "MINUTELY" : "HOURLY";\n\treturn `FREQ=${_freq};INTERVAL=${Math.max(1, hours)};BYDAY=${weekdays.join(",")}`;\n}'
    ],
    [
      'getScheduleMode识别',
      'return schedule.rrule?.includes("FREQ=HOURLY") ? "interval" : "periodic";',
      'return schedule.rrule?.includes("FREQ=HOURLY") || schedule.rrule?.includes("FREQ=MINUTELY") || schedule.rrule?.includes("FREQ=SECONDLY") ? "interval" : "periodic";'
    ],
    [
      '加getIntervalUnit',
      'function getIntervalHours(schedule) {\n\tconst match = /INTERVAL=(\\d+)/.exec(schedule.rrule || "");\n\treturn Math.max(1, Number(match?.[1] || 1));\n}',
      'function getIntervalHours(schedule) {\n\tconst match = /INTERVAL=(\\d+)/.exec(schedule.rrule || "");\n\treturn Math.max(1, Number(match?.[1] || 1));\n}\nfunction getIntervalUnit(schedule) {\n\tconst _rr = schedule.rrule || "";\n\tif (_rr.includes("FREQ=SECONDLY")) return "second";\n\tif (_rr.includes("FREQ=MINUTELY")) return "minute";\n\treturn "hour";\n}'
    ],
    [
      'onIntervalChange传unit',
      'onIntervalChange: (hours) => updateSchedule({\n\t\t\t\t\t\t\t\ttype: "recurring",\n\t\t\t\t\t\t\t\trrule: toIntervalRrule(hours, intervalWeekdays)\n\t\t\t\t\t\t\t}),',
      'onIntervalChange: (value, unit) => updateSchedule({\n\t\t\t\t\t\t\t\ttype: "recurring",\n\t\t\t\t\t\t\t\trrule: toIntervalRrule(value, intervalWeekdays, unit)\n\t\t\t\t\t\t\t}),'
    ],
    [
      'onIntervalWeekdaysChange传unit',
      'onIntervalWeekdaysChange: (days) => updateSchedule({\n\t\t\t\t\t\t\t\ttype: "recurring",\n\t\t\t\t\t\t\t\trrule: toIntervalRrule(intervalHours, days)\n\t\t\t\t\t\t\t}),',
      'onIntervalWeekdaysChange: (days) => updateSchedule({\n\t\t\t\t\t\t\t\ttype: "recurring",\n\t\t\t\t\t\t\t\trrule: toIntervalRrule(intervalHours, days, getIntervalUnit(form.schedule))\n\t\t\t\t\t\t\t}),'
    ],
    [
      '单位后缀改下拉',
      '/* @__PURE__ */ (0, import_jsx_runtime$8.jsx)("span", {\n\t\t\t\t\t\t\t\t\tclassName: "atm-schedule-control-label",\n\t\t\t\t\t\t\t\t\tchildren: t("automation.schedule.intervalExecuteSuffix")\n\t\t\t\t\t\t\t\t})',
      '/* @__PURE__ */ (0, import_jsx_runtime$8.jsx)(Select, {\n\t\t\t\t\t\t\t\t\tclassName: "atm-schedule-unit-select",\n\t\t\t\t\t\t\t\t\tsize: "medium",\n\t\t\t\t\t\t\t\t\tplacement: "bottom",\n\t\t\t\t\t\t\t\t\tvalue: getIntervalUnit(schedule),\n\t\t\t\t\t\t\t\t\toptions: [{ value: "hour", label: "小时" }, { value: "minute", label: "分钟" }, { value: "second", label: "秒" }],\n\t\t\t\t\t\t\t\t\tonChange: (unit) => onIntervalChange(intervalHours, unit)\n\t\t\t\t\t\t\t\t})'
    ],
    [
      'getFrequencySummary按单位显示',
      '\tif (mode === "interval") return t("automation.schedule.intervalSummary", {\n\t\tdays: dayText,\n\t\tcount: String(intervalHours)\n\t});',
      '\tif (mode === "interval") {\n\t\tconst _unit = getIntervalUnit(schedule);\n\t\tconst _unitLabel = _unit === "second" ? "秒" : _unit === "minute" ? "分钟" : "小时";\n\t\treturn `${dayText}，每间隔 ${intervalHours} ${_unitLabel}执行一次`;\n\t}'
    ]
  ];

  let out = source;
  for (const [name, old, neu] of targets) {
    const n = source.split(old).length - 1;
    if (n !== 1) {
      log('[RENDERER] 目标「' + name + '」命中 ' + n + ' 次（预期 1），跳过');
      continue;
    }
    out = out.split(old).join(neu);
    log('[RENDERER] 「' + name + '」已注入');
  }
  return out;
}

function contentTypeFor(path) {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.ttf')) return 'font/ttf';
  if (path.endsWith('.map')) return 'application/json';
  return 'application/octet-stream';
}

function fileUrlToPath(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname);
  } catch (_) {
    return '';
  }
}

let hooked = false;
function prepareAndHook() {
  if (hooked) return;
  try {
    const electron = require('electron');
    const { app, protocol } = electron;
    if (!app || typeof app.whenReady !== 'function' || !protocol || typeof protocol.handle !== 'function') return;
    app.whenReady().then(() => {
      try {
        // 读源文件 + patch
        const src = fs.readFileSync(SRC, 'utf8');
        log('[RENDERER] 读取源文件成功，长度 ' + src.length);
        const patched = patch(src);
        log('[RENDERER] patch 完成，长度 ' + patched.length);

        // protocol.handle 拦截 file://
        protocol.handle('file', (request) => {
          const path = fileUrlToPath(request.url);
          // 目标 chunk：返回修改内容
          if (path.indexOf('app.asar') !== -1 && path.endsWith('automation-X2oiaBDA.js')) {
            return new Response(patched, { headers: { 'Content-Type': 'application/javascript' } });
          }
          // 其他 file:// 请求：读取原始内容（Electron fs 支持 asar）
          try {
            const content = fs.readFileSync(path);
            return new Response(content, { headers: { 'Content-Type': contentTypeFor(path) } });
          } catch (e) {
            return new Response('Not found', { status: 404 });
          }
        });
        log('[RENDERER] protocol.handle 已挂载');
        hooked = true;
      } catch (e) {
        log('[RENDERER] 挂载失败: ' + (e && e.stack || e));
      }
    });
  } catch (e) {
    // electron 未就绪，稍后重试
  }
}

prepareAndHook();
setTimeout(prepareAndHook, 3000);
setTimeout(prepareAndHook, 8000);

log('[RENDERER] 注入 hook 已加载, argv[1]=' + (process.argv[1] || ''));
