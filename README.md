# WorkBuddy 自动化定时任务「分钟/秒级」注入

给腾讯 WorkBuddy（CodeBuddy 桌面版，Electron）的「自动化（Automation）」定时调度增加**分钟级、秒级**间隔控制，把原本最细「每小时」的颗粒度扩展为「时 / 分 / 秒」。

> 目标环境：WorkBuddy 5.5.6（macOS arm64 / Windows x64）。采用**运行时注入**方式，不改 `app.asar`、不碰代码签名；App 升级后重新运行注入脚本即可。

## 背景

WorkBuddy 的自动化定时调度基于 iCal RRULE，但两处硬编码把它锁死在「小时级」：

1. **主进程 daemon**（`main/server.js`）：
   - `parseRRule` 的 FREQ 白名单只放行 `HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY`，`MINUTELY/SECONDLY` 直接抛 `unsupported FREQ`；
   - `SUPPORTED_FREQUENCIES`（`automation_update` 工具校验）同样不含分钟/秒；
   - `computeNextRunAt` 只实现了 `nextHourly/nextDaily/nextMonthly/nextYearly` 四个分支。
2. **渲染进程**（`renderer/assets/automation-*.js`）：
   - 间隔配置只暴露「小时」，`toIntervalRrule` 固定生成 `FREQ=HOURLY`。

本仓库通过两层运行时注入，把分钟/秒的**解析、计算、校验、UI** 全部打通。

## 注入方式（两端不同）

| 平台 | 注入入口 | 说明 |
| --- | --- | --- |
| macOS | `NODE_OPTIONS="--require=..."` 启动 WorkBuddy | 打包版 Electron 在 macOS 上仍会应用并向下传递 `NODE_OPTIONS`，daemon 子进程能继承 |
| Windows | 往 `resources/app.asar.unpacked/node_modules/better-sqlite3/lib/index.js` 头部插入引导片段 | Windows 上打包版 Electron **会丢弃 `NODE_OPTIONS`**（GUI 进程不加载、daemon 也拿不到），无法用环境变量注入 |

Windows 之所以选这个文件作为入口：

- 它在 `app.asar.unpacked/` 下，是磁盘上的**真实文件**，不在 `app.asar` 完整性校验（`ELECTRONASAR` 资源 / `EnableEmbeddedAsarIntegrityValidation` fuse）的覆盖范围内，改动不会导致 App 拒绝启动；
- GUI 主进程与 daemon 子进程在启动早期都会 `require` 它，因此一次插入即可同时覆盖两层注入；
- 引导片段以 `WBP-BOOTSTRAP-START` / `WBP-BOOTSTRAP-END` 注释包裹，卸载即按标记删除，且不依赖文件原始内容，App 升级后也能安全重装。

## 文件结构

```
.
├── hooks/
│   ├── automation-seconds-inject.js   # 方案 A：主进程 daemon 注入（5 处 patch）
│   ├── inject-renderer.js             # 方向二：渲染进程注入（10 处 patch）
│   ├── win-asar-bootstrap.js          # Windows 引导片段（插入 better-sqlite3 入口）
│   ├── wbp-inject.ps1                 # Windows 引导安装/卸载/状态（-Action install|restore|status）
│   ├── restart-with-inject.sh         # macOS 一键退出 + 带注入重启 + 打印日志
│   └── restart-with-inject.bat        # Windows 一键安装引导 + 重启 + 打印日志
├── probes/                             # 调查过程用的探测脚本（可忽略）
└── README.md
```

## 使用方法

### macOS

```bash
mkdir -p ~/.workbuddy/hooks
cp hooks/*.js hooks/*.sh ~/.workbuddy/hooks/
~/.workbuddy/hooks/restart-with-inject.sh
```

> 关键：必须**直接运行二进制**（`open -a` 不会传递 `NODE_OPTIONS`）。

### Windows

```bat
copy hooks\*.js hooks\*.ps1 hooks\*.bat %USERPROFILE%\.workbuddy\hooks\
%USERPROFILE%\.workbuddy\hooks\restart-with-inject.bat
```

脚本会先安装引导片段（幂等）、再重启 WorkBuddy、最后打印全部日志。

只要引导片段在，**之后无论怎么启动 WorkBuddy（开始菜单、开机自启、任意方式）注入都会自动生效**，不需要每次都走这个脚本。

单独管理引导片段：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\.workbuddy\hooks\wbp-inject.ps1 -Action status
powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\.workbuddy\hooks\wbp-inject.ps1 -Action restore
```

> 若使用 **Workbuddy Plus** 桌面前端（`app/`），上面「拷贝 hook」可以省略：它启动时会自动把内置的注入脚本部署到 `~/.workbuddy/hooks/`，换机器或误删都会自恢复。

### 验证

重启后查看日志：

```bash
# macOS
cat /tmp/wb-inject-hook.log       # 主进程 daemon：应看到 5 个 [PATCH] 已注入
cat /tmp/wb-inject-renderer.log   # 渲染进程：应看到 10 个已注入 + protocol.handle 已挂载
```

```bat
REM Windows（%TEMP% 下）
type %TEMP%\wb-bootstrap.log        REM 引导加载：应各出现一行 type=browser 与 type=node
type %TEMP%\wb-inject-hook.log      REM daemon：应看到 5 个 [PATCH] 已注入
type %TEMP%\wb-inject-renderer.log  REM 渲染进程：应看到 10 个已注入 + protocol.handle 已挂载
```

然后在 WorkBuddy 的「自动化 → 新建任务 → 执行频率 → 间隔」里，即可看到「时/分/秒」单位下拉。

## 注意事项

- **macOS 重启失效**：每次冷启动 WorkBuddy 都需要带 `NODE_OPTIONS`（`restart-with-inject.sh` 已封装）。Windows 的引导片段则是持久的，重启后依然生效。
- **App 升级可能失效**：
  - macOS：字符串替换依赖具体源码，升级改动相关代码后需重新核对 patch 目标串；
  - Windows：升级会覆盖 `app.asar.unpacked`，重新执行一次 `wbp-inject.ps1 -Action install` 即可（脚本幂等）。
- **精度上限**：主进程调度 tick 为 30 秒（空闲）/ 5 秒（有活跃 run），秒级间隔的实际精度受此限制（分钟级不受影响）。
- 本方案仅在本地个人环境验证，不保证兼容其他版本。
