/**
 * 方向二注入 hook：给 WorkBuddy 自动化面板的「间隔」配置加「时/分/秒」颗粒度。
 *
 * 原理：主窗口通过 file:// 加载 app.asar 里的 renderer chunk（automation-*.js）。
 * 用 protocol.handle('file', ...) 拦截 file://：
 *   - 目标 chunk → 返回字符串替换后的内容（URL 不变，相对 import 正常）
 *   - 其他 file:// 请求 → 读取原始内容返回（Electron fs 支持 asar）
 *
 * chunk 文件名由 Vite 按内容 hash 生成，WorkBuddy 升级改动该 chunk 时会改名。
 * 因此这里不硬编码文件名：优先试已知名，否则扫描 renderer/assets/ 下所有
 * automation*.js，挑出「10 个目标串全部恰好命中 1 次」的那个作为注入目标。
 * 找不到时写醒目告警并放弃挂载 file 协议，让 WorkBuddy 回退到原生行为。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 日志路径跨平台：mac 用 /tmp，Windows 用 %TEMP%
const LOG = path.join(os.tmpdir(), 'wb-inject-renderer.log');

// 已知可用的 chunk 名（优先尝试，命中即用，省去全目录扫描）
const PREFERRED_CHUNK = 'automation-X2oiaBDA.js';

// 探测 WorkBuddy 的 app.asar 位置（mac 固定路径，Windows 优先查运行进程 + 扫描各驱动器）
function findAsarRoot() {
  if (process.platform === 'darwin') {
    const p = '/Applications/WorkBuddy.app/Contents/Resources/app.asar';
    return fs.existsSync(p) ? p : null;
  }
  if (process.platform !== 'win32') return null;

  // 1) 查运行中进程的可执行文件路径（最准，能覆盖 E:\WorkBuddy 这类非标准位置）
  try {
    const childProcess = require('child_process');
    const exe = childProcess.execSync(
      'powershell -NoProfile -Command "(Get-Process WorkBuddy -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    if (exe) {
      const p = path.join(path.dirname(exe), 'resources', 'app.asar');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) { /* 查询失败，走扫描 */ }

  // 2) 扫描常见路径 + 各驱动器根目录下的 WorkBuddy
  const bases = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'WorkBuddy'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'workbuddy'),
    path.join(process.env.PROGRAMFILES || '', 'WorkBuddy')
  ];
  for (const d of 'CDEFG') bases.push(d + ':\\WorkBuddy');
  for (const b of bases) {
    if (!b) continue;
    const p = path.join(b, 'resources', 'app.asar');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function log(m) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (_) {}
}

// 醒目告警：日志文件 + stderr 双写，避免升级后静默失效
function warn(m) {
  log('[RENDERER] ❌ 告警 ' + m);
  try { process.stderr.write('[inject-renderer] ' + m + '\n'); } catch (_) {}
}

// 10 处字符串替换
const TARGETS = [
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
  ],
  [
    '运行三角改暂停切换',
    '/* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(Tooltip, {\n\t\t\t\t\tcontent: t("automation.modal.test"),\n\t\t\t\t\tplacement: "top",\n\t\t\t\t\tchildren: /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(Button, {\n\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\tvariant: "ghost",\n\t\t\t\t\t\ticonOnly: true,\n\t\t\t\t\t\tclassName: "atm-row-action-btn atm-row-action-btn--play",\n\t\t\t\t\t\t"aria-label": t("automation.modal.test"),\n\t\t\t\t\t\tonClick: (event) => {\n\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\tonTrigger(item.id).then(() => void 0);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(RunPlayIcon, {\n\t\t\t\t\t\t\twidth: 16,\n\t\t\t\t\t\t\theight: 16\n\t\t\t\t\t\t})\n\t\t\t\t\t})\n\t\t\t\t}),',
    '/* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(Tooltip, {\n\t\t\t\t\tcontent: isActive ? t("automation.modal.pause") : t("automation.modal.resume"),\n\t\t\t\t\tplacement: "top",\n\t\t\t\t\tchildren: /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(Button, {\n\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\tvariant: "ghost",\n\t\t\t\t\t\ticonOnly: true,\n\t\t\t\t\t\tclassName: "atm-row-action-btn atm-row-action-btn--play",\n\t\t\t\t\t\t"aria-label": isActive ? t("automation.modal.pause") : t("automation.modal.resume"),\n\t\t\t\t\t\tonClick: (event) => {\n\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\tonToggleStatus(item.id, isActive ? "PAUSED" : "ACTIVE").then(() => void 0);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tchildren: isActive ? /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(CirclePauseIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(RunPlayIcon, {\n\t\t\t\t\t\t\twidth: 16,\n\t\t\t\t\t\t\theight: 16\n\t\t\t\t\t\t})\n\t\t\t\t\t})\n\t\t\t\t}),'
  ],
  [
    '三点菜单加立即运行选项',
    'items: [{\n\t\t\t\t\t\t\tkey: "toggle",',
    'items: [{\n\t\t\t\t\t\t\tkey: "trigger",\n\t\t\t\t\t\t\ticon: /* @__PURE__ */ (0, import_jsx_runtime$1.jsx)(RunPlayIcon, {}),\n\t\t\t\t\t\t\tlabel: t("automation.modal.test")\n\t\t\t\t\t\t}, {\n\t\t\t\t\t\t\tkey: "toggle",'
  ],
  [
    'onSelect加trigger处理',
    'onSelect: (key) => {\n\t\t\t\t\t\t\tif (key === "toggle") onToggleStatus(item.id, isActive ? "PAUSED" : "ACTIVE").then(() => void 0);\n\t\t\t\t\t\t\telse if (key === "delete") onDelete(item.id).then(() => void 0);\n\t\t\t\t\t\t}',
    'onSelect: (key) => {\n\t\t\t\t\t\t\tif (key === "trigger") onTrigger(item.id).then(() => void 0);\n\t\t\t\t\t\t\telse if (key === "toggle") onToggleStatus(item.id, isActive ? "PAUSED" : "ACTIVE").then(() => void 0);\n\t\t\t\t\t\t\telse if (key === "delete") onDelete(item.id).then(() => void 0);\n\t\t\t\t\t\t}'
  ]
];

// 统计每个目标串在源码中的命中次数（预期均为 1）
function analyze(source) {
  return TARGETS.map(([name, old, neu]) => {
    const hits = source.split(old).length - 1;
    return { name, old, neu, hits };
  });
}

// 仅替换恰好命中 1 次的目标；命中 0 或多次都跳过并记录
function applyPatches(source, items) {
  let out = source;
  let injected = 0;
  for (const it of items) {
    if (it.hits !== 1) {
      log('[RENDERER] 目标「' + it.name + '」命中 ' + it.hits + ' 次（预期 1），跳过');
      continue;
    }
    out = out.split(it.old).join(it.neu);
    injected += 1;
    log('[RENDERER] 「' + it.name + '」已注入');
  }
  return { out, injected, skipped: items.length - injected };
}

// 列出候选 chunk：已知名优先，其后是 renderer/assets 下的全部 automation*.js
function candidateChunks() {
  const asarRoot = findAsarRoot();
  if (!asarRoot) {
    warn('未找到 WorkBuddy 的 app.asar（platform=' + process.platform + '），注入无法进行');
    return [];
  }
  const assetsDir = path.join(asarRoot, 'renderer', 'assets');
  log('[RENDERER] app.asar 路径：' + asarRoot);

  const names = [];
  if (fs.existsSync(path.join(assetsDir, PREFERRED_CHUNK))) names.push(PREFERRED_CHUNK);
  let all = [];
  try {
    all = fs.readdirSync(assetsDir);
  } catch (e) {
    warn('无法扫描 ' + assetsDir + '：' + (e && e.message));
    return names;
  }
  for (const n of all) {
    if (/^automation.*\.js$/.test(n) && names.indexOf(n) === -1) names.push(n);
  }
  return names;
}

// 自动发现目标 chunk 并打补丁；成功返回 { name, patched }，失败返回 null
function resolveAndPatch() {
  const asarRoot = findAsarRoot();
  const assetsDir = asarRoot ? path.join(asarRoot, 'renderer', 'assets') : '';
  const names = candidateChunks();
  if (names.length === 0) {
    warn('在 ' + (assetsDir || '(未定位)') + ' 下未找到任何 automation*.js，注入无法进行（WorkBuddy 结构可能已变）');
    return null;
  }
  log('[RENDERER] 候选 chunk：' + names.join(', '));

  let best = null;
  for (const name of names) {
    let src;
    try {
      src = fs.readFileSync(path.join(assetsDir, name), 'utf8');
    } catch (e) {
      log('[RENDERER] 读取 ' + name + ' 失败：' + (e && e.message));
      continue;
    }
    const items = analyze(src);
    const okCount = items.filter((i) => i.hits === 1).length;
    log('[RENDERER] 候选 ' + name + '（长度 ' + src.length + '）：完整命中 ' + okCount + '/' + items.length);
    if (!best || okCount > best.okCount) best = { name, src, items, okCount };
    if (okCount === items.length) break; // 全中，直接用
  }

  if (!best) {
    warn('所有候选 chunk 均读取失败，注入无法进行');
    return null;
  }
  if (best.okCount !== best.items.length) {
    warn('最佳候选 ' + best.name + ' 仅 ' + best.okCount + '/' + best.items.length +
      ' 个目标可注入 —— WorkBuddy 很可能已升级并改动了该 chunk，需重新核对 patch 目标串');
    return null; // 宁可不注入，也不返回半吊子页面
  }

  const { out, injected } = applyPatches(best.src, best.items);
  log('[RENDERER] 选定 ' + best.name + '，patch 完成：' + injected + ' 处，长度 ' + best.src.length + ' -> ' + out.length);
  return { name: best.name, patched: out };
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
    let p = decodeURIComponent(u.pathname);
    // Windows 上 file:///C:/xxx 的 pathname 是 /C:/xxx，去掉开头的 /
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) {
      p = p.slice(1);
    }
    return p;
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
        const resolved = resolveAndPatch();
        if (!resolved) {
          warn('未挂载 file 协议拦截，WorkBuddy 将按原生行为运行（自动化面板不会有分/秒选项）');
          return;
        }

        // protocol.handle 拦截 file://
        protocol.handle('file', (request) => {
          const path = fileUrlToPath(request.url);
          // 自动发现的目标 chunk：返回修改内容
          if (path.indexOf('app.asar') !== -1 && path.endsWith('/' + resolved.name)) {
            return new Response(resolved.patched, { headers: { 'Content-Type': 'application/javascript' } });
          }
          // 其他 file:// 请求：读取原始内容（Electron fs 支持 asar）
          try {
            const content = fs.readFileSync(path);
            return new Response(content, { headers: { 'Content-Type': contentTypeFor(path) } });
          } catch (e) {
            return new Response('Not found', { status: 404 });
          }
        });
        log('[RENDERER] protocol.handle 已挂载（目标 chunk：' + resolved.name + '）');
        hooked = true;
      } catch (e) {
        warn('挂载失败: ' + (e && e.stack || e));
      }
    });
  } catch (e) {
    // electron 未就绪，稍后重试
  }
}

prepareAndHook();
setTimeout(prepareAndHook, 3000);
setTimeout(prepareAndHook, 8000);

log('[RENDERER] 注入 hook 已加载, platform=' + process.platform + ', argv[1]=' + (process.argv[1] || '') + ', log=' + LOG);
