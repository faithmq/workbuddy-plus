// 预加载脚本：通过 contextBridge 向渲染进程暴露受控的 IPC 接口
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 获取 WorkBuddy 与脚本的检查状态
  checkStatus: () => ipcRenderer.invoke('check-status'),
  // 触发带注入的 WorkBuddy 启动
  startWorkbuddy: () => ipcRenderer.invoke('start-workbuddy'),
  // 重新部署内置注入脚本到 ~/.workbuddy/hooks（强制覆盖）
  deployHooks: () => ipcRenderer.invoke('deploy-hooks')
});
