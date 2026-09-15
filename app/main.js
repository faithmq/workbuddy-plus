// WorkBuddy 注入工具前端 —— Electron 主进程
// 职责：创建窗口、检查 WorkBuddy/脚本运行条件、触发带注入的启动
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WB_PATH = '/Applications/WorkBuddy.app';
const WB_PLIST = path.join(WB_PATH, 'Contents', 'Info.plist');
const WB_BIN = path.join(WB_PATH, 'Contents', 'MacOS', 'Electron');
const HOOKS_DIR = path.join(os.homedir(), '.workbuddy', 'hooks');

const HOOK_FILES = [
  { name: 'automation-seconds-inject.js', purpose: '主进程 daemon 注入' },
  { name: 'inject-renderer.js', purpose: '渲染进程注入' },
  { name: 'restart-with-inject.sh', purpose: '一键重启注入脚本' }
];

// 安全地执行 shell 命令，返回 stdout 或 null
function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 8000 }).trim();
  } catch (_) {
    return null;
  }
}

// 检查 WorkBuddy 版本（读 Info.plist 的 CFBundleShortVersionString）
function checkVersion() {
  const v = run(`plutil -extract CFBundleShortVersionString raw "${WB_PLIST}"`);
  return v || null;
}

// 检查 WorkBuddy 是否在运行
function checkRunning() {
  const out = run('pgrep -f "WorkBuddy.app/Contents/MacOS"');
  return !!out;
}

// 收集全部状态
function collectStatus() {
  const version = checkVersion();
  const exists = fs.existsSync(WB_PATH);
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
      value: exists ? WB_PATH : '未找到',
      valueType: 'text',
      note: exists ? '应用存在' : '未在 /Applications 找到 WorkBuddy',
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
    wbPath: WB_PATH,
    running,
    healthItems,
    scripts: hooks,
    checksPassed: healthItems.filter((h) => h.status === 'ok').length + hooksOk,
    checksTotal: healthItems.length + hooksTotal,
    scriptsAvailable: hooksOk,
    scriptsTotal: hooksTotal
  };
}

// 触发带注入的启动：执行 restart-with-inject.sh
function startWorkbuddy() {
  const script = path.join(HOOKS_DIR, 'restart-with-inject.sh');
  if (!fs.existsSync(script)) {
    return { ok: false, error: '重启脚本不存在：' + script };
  }
  // 异步执行（脚本内包含退出 + 等待 + 重启，耗时约 20s，不能阻塞主进程）
  exec(`bash "${script}"`, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[start-workbuddy] 失败:', err.message);
    } else {
      console.log('[start-workbuddy] 完成');
    }
  });
  return { ok: true, message: '已触发带注入的 WorkBuddy 启动' };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'WorkBuddy 注入工具',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
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
  // IPC：获取检查状态
  ipcMain.handle('check-status', () => collectStatus());
  // IPC：启动 WorkBuddy
  ipcMain.handle('start-workbuddy', () => startWorkbuddy());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
