/**
 * WorkBuddy automation 定时调度「分钟/秒级」注入 hook（方案 A）
 *
 * 通过 NODE_OPTIONS="--require=本文件" 注入 daemon 主进程。
 * daemon 以 ELECTRON_RUN_AS_NODE=1 启动（纯 Node），会执行 NODE_OPTIONS；
 * 主进程 DaemonAppServerProcessManager 的 sanitizeNodeOptions 只滤
 * --openssl-legacy-provider / --inspect* / --debug，放行 --require。
 *
 * 原理：拦截 Module.prototype._compile，在 server.js 编译前对其源码做
 * 字符串替换，放开 RRULE 的 SECONDLY / MINUTELY 频率（原本只到 HOURLY）。
 * 并在注入点追加一段自测，把 parseRRule/computeNextRunAt 对 MINUTELY/SECONDLY
 * 的结果写到 /tmp/wb-selftest.log，用于验证 patch 是否真正生效。
 */
'use strict';

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 日志路径跨平台：mac 用 /tmp，Windows 用 %TEMP%
const LOG_FILE = path.join(os.tmpdir(), 'wb-inject-hook.log');
const SELFTEST_FILE = path.join(os.tmpdir(), 'wb-selftest.log');
const ENABLED = true; // 置 false 可临时关闭注入

function log() {
  try {
    const args = Array.prototype.slice.call(arguments).map((x) => String(x));
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + args.join(' ') + '\n');
  } catch (_) {
    /* 日志失败不阻断加载 */
  }
}

// 自测代码：注入到 server.js 模块作用域内（nextHourly 之后），加载时立即执行。
// 单行写法，避免转义层级混淆；日志路径用 JSON.stringify 嵌入（跨平台、自动转义）。
const SELFTEST_CODE = ';(function(){var _l=function(m){try{require("fs").appendFileSync(' + JSON.stringify(SELFTEST_FILE) + ',"["+Date.now()+"] "+m+"\\n");}catch(e){}};var _n=Date.now();' +
  'try{var _r1=parseRRule$1("FREQ=MINUTELY;INTERVAL=5");_l("parseRRule MINUTELY OK: "+JSON.stringify(_r1));}catch(e){_l("parseRRule MINUTELY FAIL: "+(e&&e.message));}' +
  'try{var _r2=parseRRule$1("FREQ=SECONDLY;INTERVAL=30");_l("parseRRule SECONDLY OK: "+JSON.stringify(_r2));}catch(e){_l("parseRRule SECONDLY FAIL: "+(e&&e.message));}' +
  'try{var _n1=computeNextRunAt$1({type:"recurring",rrule:"FREQ=MINUTELY;INTERVAL=5"},_n);_l("computeNextRunAt MINUTELY OK: nextRunAt="+_n1+" delta="+(_n1-_n)+"ms");}catch(e){_l("computeNextRunAt MINUTELY FAIL: "+(e&&e.message));}' +
  'try{var _n2=computeNextRunAt$1({type:"recurring",rrule:"FREQ=SECONDLY;INTERVAL=30"},_n);_l("computeNextRunAt SECONDLY OK: nextRunAt="+_n2+" delta="+(_n2-_n)+"ms");}catch(e){_l("computeNextRunAt SECONDLY FAIL: "+(e&&e.message));}' +
  '})();';

function patchServerSource(source) {
  const hit = (old) => source.split(old).length - 1;

  // Patch 1：parseRRule 的 FREQ 白名单，放开 SECONDLY / MINUTELY
  const freqOld = 'if (rawFreq !== "HOURLY" && rawFreq !== "DAILY" && rawFreq !== "WEEKLY" && rawFreq !== "MONTHLY" && rawFreq !== "YEARLY") invalidRule(`unsupported FREQ=${rawFreq}`);';
  const freqNew = 'if (rawFreq !== "SECONDLY" && rawFreq !== "MINUTELY" && rawFreq !== "HOURLY" && rawFreq !== "DAILY" && rawFreq !== "WEEKLY" && rawFreq !== "MONTHLY" && rawFreq !== "YEARLY") invalidRule(`unsupported FREQ=${rawFreq}`);';

  // Patch 2：parseRRule 返回对象增加 bysecond 解析（SECONDLY 需要）
  const byOld = 'byminute: parseClampedInt(map.get("BYMINUTE"), 0, 59, 0)';
  const byNew = 'byminute: parseClampedInt(map.get("BYMINUTE"), 0, 59, 0),\n\t\tbysecond: parseClampedInt(map.get("BYSECOND"), 0, 59, 0)';

  // Patch 3：computeNextRunAt 增加 SECONDLY / MINUTELY 分支
  const brOld = '\tlet candidate;\n\tif (parsed.freq === "HOURLY") candidate = nextHourly(parsed, now, searchFrom);\n\telse if (parsed.freq === "MONTHLY") candidate = nextMonthly(parsed, now, searchFrom);\n\telse if (parsed.freq === "YEARLY") candidate = nextYearly(parsed, now, searchFrom);\n\telse candidate = nextDaily(parsed, now, searchFrom, validFrom);';
  const brNew = '\tlet candidate;\n\tif (parsed.freq === "SECONDLY") candidate = nextSecondly(parsed, now, searchFrom);\n\telse if (parsed.freq === "MINUTELY") candidate = nextMinutely(parsed, now, searchFrom);\n\telse if (parsed.freq === "HOURLY") candidate = nextHourly(parsed, now, searchFrom);\n\telse if (parsed.freq === "MONTHLY") candidate = nextMonthly(parsed, now, searchFrom);\n\telse if (parsed.freq === "YEARLY") candidate = nextYearly(parsed, now, searchFrom);\n\telse candidate = nextDaily(parsed, now, searchFrom, validFrom);';

  // Patch 4：在 nextHourly 后插入 nextMinutely / nextSecondly + 自测代码
  const nhOld = 'function nextHourly(parsed, now, searchFrom) {\n\tconst intervalMs = parsed.interval * 60 * 60 * 1e3;\n\tlet candidate = Math.max(now, searchFrom) + intervalMs;\n\tfor (let i = 0; i <= MAX_HOUR_LOOKAHEAD; i += 1) {\n\t\tif (candidate > now && candidate >= searchFrom && matchesByday(candidate, parsed.byday)) return candidate;\n\t\tcandidate += 3600 * 1e3;\n\t}\n}';
  const nhNew = nhOld + '\nfunction nextMinutely(parsed, now, searchFrom) {\n\tconst intervalMs = parsed.interval * 60 * 1e3;\n\tlet candidate = Math.max(now, searchFrom) + intervalMs;\n\tfor (let i = 0; i <= MAX_HOUR_LOOKAHEAD * 60; i += 1) {\n\t\tif (candidate > now && candidate >= searchFrom && matchesByday(candidate, parsed.byday)) return candidate;\n\t\tcandidate += 60 * 1e3;\n\t}\n}\nfunction nextSecondly(parsed, now, searchFrom) {\n\tconst intervalMs = parsed.interval * 1e3;\n\tlet candidate = Math.max(now, searchFrom) + intervalMs;\n\tfor (let i = 0; i <= MAX_HOUR_LOOKAHEAD * 3600; i += 1) {\n\t\tif (candidate > now && candidate >= searchFrom && matchesByday(candidate, parsed.byday)) return candidate;\n\t\tcandidate += 1e3;\n\t}\n}' + SELFTEST_CODE;

  // Patch 5：automation_update 工具创建/更新时的 SUPPORTED_FREQUENCIES 白名单
  const supOld = 'var SUPPORTED_FREQUENCIES = new Set([\n\t"DAILY",\n\t"HOURLY",\n\t"WEEKLY",\n\t"MONTHLY",\n\t"YEARLY"\n]);';
  const supNew = 'var SUPPORTED_FREQUENCIES = new Set([\n\t"DAILY",\n\t"HOURLY",\n\t"WEEKLY",\n\t"MONTHLY",\n\t"YEARLY",\n\t"MINUTELY",\n\t"SECONDLY"\n]);';

  const targets = [
    ['FREQ白名单', freqOld, freqNew],
    ['bysecond', byOld, byNew],
    ['computeNextRunAt分支', brOld, brNew],
    ['nextMinutely/nextSecondly+自测', nhOld, nhNew],
    ['SUPPORTED_FREQUENCIES白名单', supOld, supNew]
  ];

  let out = source;
  for (let i = 0; i < targets.length; i += 1) {
    const name = targets[i][0];
    const old = targets[i][1];
    const neu = targets[i][2];
    const n = hit(old);
    if (n !== 1) {
      log('[PATCH] 目标「' + name + '」命中 ' + n + ' 次（预期 1），跳过');
      continue;
    }
    out = out.split(old).join(neu);
    log('[PATCH] 「' + name + '」已注入');
  }
  return out;
}

const originalCompile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
  try {
    if (ENABLED && typeof content === 'string' && filename && /main[\\/]server\.js$/.test(filename)) {
      log('[HOOK] 拦截 server.js: ' + filename);
      content = patchServerSource(content);
    }
  } catch (e) {
    log('[HOOK] patch 异常: ' + ((e && e.stack) || e));
  }
  return originalCompile.call(this, content, filename);
};

log('[HOOK] 注入 hook 已加载, platform=' + process.platform + ', node=' + process.version + ', argv[1]=' + (process.argv[1] || '') + ', log=' + LOG_FILE);
