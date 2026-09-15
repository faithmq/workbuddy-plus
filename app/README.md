# WorkBuddy 注入工具前端

给 WorkBuddy 自动化注入工具的**独立桌面前端**（Electron），用于检查运行条件并一键带注入启动 WorkBuddy。

## 功能

- **概览**：检查 WorkBuddy 版本 / 路径 / 运行状态，以及注入脚本（hooks）的可用性；
- **一键启动**：点击「启动 WorkBuddy」即退出当前实例并带注入参数重启（等价于 `restart-with-inject.sh`）；
- **关于**：工具介绍与使用说明。

## 运行

```bash
cd app
npm install       # 安装 electron（约 100MB）
npm start         # 启动
```

> 依赖同目录下 `~/.workbuddy/hooks/` 里的注入脚本（由仓库 `hooks/` 目录安装）。

## 结构

```
app/
├── main.js          # 主进程：检查逻辑 + 启动 WorkBuddy
├── preload.js       # contextBridge 暴露 IPC
└── renderer/
    ├── index.html   # 界面（复用设计原型）
    └── renderer.js  # 渲染逻辑
```

## 打包（可选）

未配置打包，当前以 `npm start` 运行。需要 `.app`/`.dmg` 时可用 `electron-builder` 补充。
