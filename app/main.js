// WorkBuddy 注入工具前端 —— Electron 主进程
// 职责：创建窗口、检查 WorkBuddy/脚本运行条件、触发带注入的启动
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const HOOKS_DIR = path.join(os.homedir(), '.workbuddy', 'hooks');

// WorkBuddy 安装路径探测（mac 固定 /Applications；Windows 优先查运行进程 + 扫描各驱动器）
function findWorkbuddyPath() {
  if (isMac) {
    const p = '/Applications/WorkBuddy.app';
    return fs.existsSync(p) ? p : null;
  }
  if (!isWin) return null;

  // 1) 查运行中进程的可执行文件路径（最准，能覆盖 E:\WorkBuddy 这类非标准位置）
  try {
    const exe = execSync(
      'powershell -NoProfile -Command "(Get-Process WorkBuddy -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    if (exe) {
      const dir = path.dirname(exe);
      if (fs.existsSync(dir)) return dir;
    }
  } catch (_) { /* 查询失败，走扫描 */ }

  // 2) 扫描常见路径 + 各驱动器根目录下的 WorkBuddy
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'WorkBuddy'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'workbuddy'),
    path.join(process.env.PROGRAMFILES || '', 'WorkBuddy')
  ].filter((p) => p && !p.endsWith(path.sep));
  for (const d of 'CDEFG') candidates.push(d + ':\\WorkBuddy');
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 找 WorkBuddy 可执行文件
function findWorkbuddyExe(wbPath) {
  if (!wbPath) return null;
  if (isMac) return path.join(wbPath, 'Contents', 'MacOS', 'Electron');
  for (const name of ['WorkBuddy.exe', 'Electron.exe', 'workbuddy.exe']) {
    const p = path.join(wbPath, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const HOOK_FILES = [
  { name: 'automation-seconds-inject.js', purpose: '主进程 daemon 注入', mode: 0o644 },
  { name: 'inject-renderer.js', purpose: '渲染进程注入', mode: 0o644 },
  { name: 'win-asar-bootstrap.js', purpose: 'Windows 注入引导片段', mode: 0o644 },
  { name: 'wbp-inject.ps1', purpose: 'Windows 引导安装/卸载', mode: 0o644 },
  { name: isWin ? 'restart-with-inject.bat' : 'restart-with-inject.sh', purpose: '一键重启注入脚本', mode: isWin ? 0o644 : 0o755 }
];

// 随 app 打包的内置副本（构建期由 scripts/sync-hooks.js 从仓库根目录 hooks/ 同步而来）
const BUNDLED_HOOKS_DIR = path.join(__dirname, 'hooks');
const DEPLOY_LOG = isWin ? path.join(os.tmpdir(), 'wbp-deploy.log') : '/tmp/wbp-deploy.log';

// 安全地执行 shell 命令，返回 stdout 或 null
function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 8000 }).trim();
  } catch (_) {
    return null;
  }
}

// 检查 WorkBuddy 版本（mac 读 Info.plist，Windows 读 exe 版本信息）
function checkVersion(wbPath) {
  if (!wbPath) return null;
  if (isMac) {
    const plist = path.join(wbPath, 'Contents', 'Info.plist');
    return run(`plutil -extract CFBundleShortVersionString raw "${plist}"`);
  }
  if (isWin) {
    const exe = findWorkbuddyExe(wbPath);
    if (!exe) return null;
    return run(`powershell -NoProfile -Command "(Get-Item '${exe}').VersionInfo.ProductVersion"`);
  }
  return null;
}

// 检查 WorkBuddy 是否在运行
function checkRunning() {
  if (isMac) {
    return !!run('pgrep -f "WorkBuddy.app/Contents/MacOS"');
  }
  if (isWin) {
    return !!run('tasklist /FI "IMAGENAME eq WorkBuddy.exe" /NH');
  }
  return false;
}

// 收集全部状态
function collectStatus() {
  const wbPath = findWorkbuddyPath();
  const exists = !!wbPath;
  const version = checkVersion(wbPath);
  const running = checkRunning();

  const hooks = HOOK_FILES.map((f) => {
    const p = path.join(HOOKS_DIR, f.name);
    const present = fs.existsSync(p);
    let status = 'bad';
    let statusLabel = '缺失';
    if (present) {
      status = 'ok';
      statusLabel = '可用';
      // 对 .sh 脚本额外检查可执行权限
      if (f.name.endsWith('.sh')) {
        try {
          fs.accessSync(p, fs.constants.X_OK);
        } catch (_) {
          status = 'warn';
          statusLabel = '无执行权限';
        }
      }
    }
    return {
      id: f.name,
      name: f.name,
      purpose: f.purpose,
      status,
      statusLabel
    };
  });

  const hooksOk = hooks.filter((h) => h.status === 'ok').length;
  const hooksTotal = hooks.length;

  const healthItems = [
    {
      id: 'wb-path',
      label: 'WorkBuddy 路径',
      value: exists ? wbPath : '未找到',
      valueType: 'text',
      note: exists ? '应用存在' : (isMac ? '未在 /Applications 找到 WorkBuddy' : '未在常见安装位置找到 WorkBuddy'),
      status: exists ? 'ok' : 'bad'
    },
    {
      id: 'wb-version',
      label: 'WorkBuddy 版本',
      value: version || '—',
      valueType: 'number',
      note: version ? '版本号已读取' : '无法读取版本号',
      status: version ? 'ok' : 'bad'
    },
    {
      id: 'wb-running',
      label: '运行状态',
      value: running ? '运行中' : '未运行',
      valueType: 'text',
      note: running ? 'WorkBuddy 进程正在运行' : '当前未检测到 WorkBuddy 进程',
      status: running ? 'ok' : 'warn'
    },
    {
      id: 'hooks-ready',
      label: '注入脚本',
      value: `${hooksOk}/${hooksTotal} 就绪`,
      valueType: 'number',
      note: hooksOk === hooksTotal ? '注入脚本全部就绪' : '部分注入脚本缺失或不可用',
      status: hooksOk === hooksTotal ? 'ok' : hooksOk === 0 ? 'bad' : 'warn'
    }
  ];

  // 总体状态：全 ok = ok；有 bad = bad；否则 warn
  const hasBad = healthItems.some((h) => h.status === 'bad') || hooks.some((h) => h.status === 'bad');
  const hasWarn = healthItems.some((h) => h.status === 'warn') || hooks.some((h) => h.status === 'warn');
  const overall = hasBad ? 'bad' : hasWarn ? 'warn' : 'ok';

  return {
    overall,
    version: version || '—',
    wbPath: wbPath || '—',
    running,
    platform: isMac ? 'macOS' : isWin ? 'Windows' : process.platform,
    healthItems,
    scripts: hooks,
    checksPassed: healthItems.filter((h) => h.status === 'ok').length + hooksOk,
    checksTotal: healthItems.length + hooksTotal,
    scriptsAvailable: hooksOk,
    scriptsTotal: hooksTotal
  };
}

// 触发带注入的启动：执行 restart-with-inject.sh（mac）或 .bat（Windows）
function startWorkbuddy() {
  const wbPath = findWorkbuddyPath();
  if (!wbPath) {
    return { ok: false, error: '未找到 WorkBuddy 安装路径' };
  }
  const scriptName = isWin ? 'restart-with-inject.bat' : 'restart-with-inject.sh';
  const script = path.join(HOOKS_DIR, scriptName);
  if (!fs.existsSync(script)) {
    return { ok: false, error: '重启脚本不存在：' + script };
  }
  // 非交互调用：让脚本跳过结尾的 pause（否则被 exec 拉起时会一直挂到超时）
  const cmd = isWin ? `set WBP_NOPAUSE=1&& "${script}"` : `bash "${script}"`;
  // 异步执行（脚本内包含退出 + 等待 + 重启，耗时约 20s，不能阻塞主进程）
  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[start-workbuddy] 失败:', err.message);
    } else {
      console.log('[start-workbuddy] 完成');
    }
  });
  return { ok: true, message: '已触发带注入的 WorkBuddy 启动' };
}

// 把随 app 打包的内置注入脚本部署到 ~/.workbuddy/hooks/
// mode='auto'：补齐缺失的；已存在但内容与内置不同则更新（旧文件先备份为 .bak）
// mode='force'：一律重写，供界面「重新部署」按钮使用
function deployHooks(mode) {
  const result = {
    ok: true, mode,
    deployed: [], updated: [], skipped: [], fixed: [], backedUp: [], errors: []
  };
  const log = (m) => {
    try { fs.appendFileSync(DEPLOY_LOG, '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (_) {}
  };

  try {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });
  } catch (e) {
    result.ok = false;
    result.errors.push('无法创建 ' + HOOKS_DIR + '：' + e.message);
    log('创建目录失败：' + e.message);
    return result;
  }

  for (const f of HOOK_FILES) {
    const src = path.join(BUNDLED_HOOKS_DIR, f.name);
    const dst = path.join(HOOKS_DIR, f.name);

    let content;
    try {
      content = fs.readFileSync(src);
    } catch (e) {
      result.errors.push(f.name + '：内置副本读取失败（' + e.message + '）');
      log(f.name + ' 内置副本读取失败：' + e.message);
      continue;
    }

    const exists = fs.existsSync(dst);
    let identical = false;
    if (exists) {
      try { identical = fs.readFileSync(dst).equals(content); } catch (_) { identical = false; }
    }

    // 内容一致且非强制：只校正权限（asar 不保留可执行位，手抄也可能丢）
    if (exists && identical && mode !== 'force') {
      try {
        if ((fs.statSync(dst).mode & 0o777) !== f.mode) {
          fs.chmodSync(dst, f.mode);
          result.fixed.push(f.name);
          log('修正权限 ' + f.name);
        }
      } catch (_) { /* 权限修正失败不阻断 */ }
      result.skipped.push(f.name);
      continue;
    }

    if (exists) {
      try {
        fs.copyFileSync(dst, dst + '.bak');
        result.backedUp.push(f.name + '.bak');
      } catch (_) { /* 备份失败不阻断部署 */ }
    }

    try {
      fs.writeFileSync(dst, content, { mode: f.mode });
      fs.chmodSync(dst, f.mode);
      (exists ? result.updated : result.deployed).push(f.name);
      log((exists ? '更新 ' : '部署 ') + f.name);
    } catch (e) {
      result.errors.push(f.name + '：写入失败（' + e.message + '）');
      log(f.name + ' 写入失败：' + e.message);
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'Workbuddy Plus',
    // macOS 用 hiddenInset 标题栏；Windows 用默认标题栏
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 外链用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // 启动即自动部署内置注入脚本：补齐缺失、更新旧版
  // 这样换机器 / 重装 / 误删 ~/.workbuddy/hooks 后不会再落到「脚本缺失」状态
  try {
    const r = deployHooks('auto');
    console.log('[deploy-hooks] auto:', JSON.stringify(r));
  } catch (e) {
    console.error('[deploy-hooks] auto 失败:', e && e.message);
  }

  // IPC：获取检查状态
  ipcMain.handle('check-status', () => collectStatus());
  // IPC：启动 WorkBuddy
  ipcMain.handle('start-workbuddy', () => startWorkbuddy());
  // IPC：重新部署内置注入脚本（强制覆盖）
  ipcMain.handle('deploy-hooks', () => deployHooks('force'));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
