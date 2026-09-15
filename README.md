# WorkBuddy 自动化定时任务「分钟/秒级」注入

给腾讯 WorkBuddy（CodeBuddy 桌面版，Electron）的「自动化（Automation）」定时调度增加**分钟级、秒级**间隔控制，把原本最细「每小时」的颗粒度扩展为「时 / 分 / 秒」。

> 目标环境：WorkBuddy 5.5.6（macOS arm64）。采用**运行时注入**方式，不改 `app.asar`、不碰代码签名、App 升级后重新运行注入脚本即可。

## 背景

WorkBuddy 的自动化定时调度基于 iCal RRULE，但两处硬编码把它锁死在「小时级」：

1. **主进程 daemon**（`main/server.js`）：
   - `parseRRule` 的 FREQ 白名单只放行 `HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY`，`MINUTELY/SECONDLY` 直接抛 `unsupported FREQ`；
   - `SUPPORTED_FREQUENCIES`（`automation_update` 工具校验）同样不含分钟/秒；
   - `computeNextRunAt` 只实现了 `nextHourly/nextDaily/nextMonthly/nextYearly` 四个分支。
2. **渲染进程**（`renderer/assets/automation-X2oiaBDA.js`）：
   - 间隔配置只暴露「小时」，`toIntervalRrule` 固定生成 `FREQ=HOURLY`。

本仓库通过两层运行时注入，把分钟/秒的**解析、计算、校验、UI** 全部打通。

## 方案总览

| 层 | 注入目标 | 方式 | 效果 |
|----|----------|------|------|
| 方案 A | 主进程 daemon `server.js` | `NODE_OPTIONS=--require` hook | 放开 `MINUTELY/SECONDLY` 的解析、计算、校验 |
| 方向二 | 渲染进程 `automation-X2oiaBDA.js` | `protocol.handle('file')` 拦截 | 间隔配置 UI 增加「时/分/秒」单位下拉 + 摘要正确显示 |

## 文件结构

```
.
├── hooks/
│   ├── automation-seconds-inject.js   # 方案 A：主进程 daemon 注入（5 处 patch）
│   ├── inject-renderer.js             # 方向二：渲染进程注入（7 处 patch）
│   └── restart-with-inject.sh         # 一键退出 + 带注入重启 + 打印日志
├── probes/                             # 调查过程用的探测脚本（可忽略）
│   ├── probe-main.js                   # 探测 loadFile 实际加载路径
│   └── probe-file.js                   # 探测 file:// chunk 请求
└── README.md
```

## 使用方法

### 一次性运行（推荐）

```bash
# 1. 安装 hook 到 ~/.workbuddy/hooks/
mkdir -p ~/.workbuddy/hooks
cp hooks/*.js hooks/*.sh ~/.workbuddy/hooks/

# 2. 一键重启（退出 WorkBuddy → 带注入重启 → 打印日志）
~/.workbuddy/hooks/restart-with-inject.sh
```

### 手动重启

```bash
# 关键：必须直接运行二进制（open -a 不会传递 NODE_OPTIONS 环境变量）
NODE_OPTIONS="--require=$HOME/.workbuddy/hooks/automation-seconds-inject.js --require=$HOME/.workbuddy/hooks/inject-renderer.js" \
  /Applications/WorkBuddy.app/Contents/MacOS/Electron
```

### 验证

重启后查看日志：

```bash
cat /tmp/wb-inject-hook.log       # 主进程 daemon：应看到 5 个 [PATCH] 已注入
cat /tmp/wb-inject-renderer.log   # 渲染进程：应看到 7 个已注入 + protocol.handle 已挂载
```

然后在 WorkBuddy 的「自动化 → 新建任务 → 执行频率 → 间隔」里，即可看到「时/分/秒」单位下拉。

## 技术原理

### 方案 A：注入主进程 daemon

WorkBuddy 的 daemon 子进程（`daemon-app-server-entry.js`）由主进程以 `ELECTRON_RUN_AS_NODE=1` 启动（纯 Node），且主进程会把 `sanitizeNodeOptions(process.env.NODE_OPTIONS)` 传给它——其中 `--require` 不在过滤名单里（只滤 `--openssl-legacy-provider`、`--inspect*`、`--debug`）。

因此设置 `NODE_OPTIONS="--require=automation-seconds-inject.js"`，即可让 daemon 在加载 `server.js` 前执行 hook。hook 拦截 `Module.prototype._compile`，对 `main/server.js` 源码做 5 处字符串替换：

1. `parseRRule` 的 FREQ 白名单加 `SECONDLY/MINUTELY`；
2. `parseRRule` 返回对象加 `bysecond` 解析；
3. `computeNextRunAt` 加 `SECONDLY/MINUTELY` 分支；
4. 插入 `nextMinutely`/`nextSecondly` 计算函数；
5. `SUPPORTED_FREQUENCIES`（automation_update 工具校验）加 `MINUTELY/SECONDLY`。

### 方向二：注入渲染进程

渲染进程是独立的 Chromium 进程，`NODE_OPTIONS` 进不去，CDP 也拦不住 `app://`（自定义协议）。但主窗口的 chunk 通过 `file://` 加载，主进程的 `protocol.handle('file', ...)` 可以拦截：

- 目标 chunk（`automation-X2oiaBDA.js`）→ 返回字符串替换后的内容（**URL 不变**，相对 import 正常）；
- 其他 `file://` 请求 → 读取原始内容返回（Electron 的 `fs` 支持 asar）。

对 `automation-X2oiaBDA.js` 做 7 处替换：`toIntervalRrule` 加单位参数、`getScheduleMode`/`getIntervalUnit` 识别分钟秒、`onIntervalChange` 传递单位、间隔面板加「时/分/秒」单位下拉、频率摘要按单位显示。

## 注意事项

- **运行时注入，重启失效**：每次冷启动 WorkBuddy 都需要带 `NODE_OPTIONS`（`restart-with-inject.sh` 已封装）。
- **App 升级可能失效**：字符串替换依赖具体源码，若 WorkBuddy 升级改动相关代码，需重新核对 patch 目标串。
- **精度上限**：主进程调度 tick 为 30 秒（空闲）/ 5 秒（有活跃 run），秒级间隔的实际精度受此限制（分钟级不受影响）。
- 本方案仅在本地个人环境验证，不保证兼容其他版本。
