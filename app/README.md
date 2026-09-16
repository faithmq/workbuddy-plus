# WorkBuddy 注入工具前端

给 WorkBuddy 自动化注入工具的**独立桌面前端**（Electron），用于检查运行条件并一键带注入启动 WorkBuddy。

## 功能

- **脚本自愈**：注入脚本随应用打包，**启动时自动部署**到 `~/.workbuddy/hooks/`（补齐缺失、更新旧版）；也可点「部署脚本」按钮强制重新部署；
- **概览**：检查 WorkBuddy 版本 / 路径 / 运行状态，以及注入脚本（hooks）的可用性；
- **一键启动**：点击「启动 WorkBuddy」即退出当前实例并带注入参数重启（等价于 `restart-with-inject.sh`）；
- **关于**：工具介绍与使用说明。

## 运行

```bash
cd app
npm install       # 安装 electron（约 100MB）
npm start         # 启动（会先同步 hooks/ 到 app/hooks/）
```

## 打包

```bash
cd app
npm run dist      # 先 sync-hooks 再 electron-builder，产物在 app/dist/
```

## 结构

```
app/
├── main.js          # 主进程：检查逻辑 + 部署 hooks + 启动 WorkBuddy
├── preload.js       # contextBridge 暴露 IPC
├── scripts/
│   └── sync-hooks.js # 构建期把仓库根目录 hooks/ 同步到 app/hooks/
├── hooks/           # 构建产物（已 gitignore），随 app 打包的内置注入脚本
└── renderer/
    ├── index.html   # 界面（复用设计原型）
    └── renderer.js  # 渲染逻辑
```

## 注入脚本的部署规则

源永远以**仓库根目录的 `hooks/`** 为准，`app/hooks/` 只是构建期同步出来的副本。

| 场景 | 行为 |
|---|---|
| 目标文件不存在 | 自动写入 |
| 已存在但内容与内置不同 | 自动更新，旧文件备份为 `<name>.bak` |
| 内容一致、权限不对 | 只校正权限（`.sh` 需可执行位） |
| 点「部署脚本」按钮 | 强制重写全部（同样先备份） |

## 打包（可选）

未配置打包，当前以 `npm start` 运行。需要 `.app`/`.dmg` 时可用 `electron-builder` 补充。
