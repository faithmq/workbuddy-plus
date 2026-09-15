// 预加载脚本：通过 contextBridge 向渲染进程暴露受控的 IPC 接口
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 获取 WorkBuddy 与脚本的检查状态
  checkStatus: () => ipcRenderer.invoke('check-status'),
  // 触发带注入的 WorkBuddy 启动
  startWorkbuddy: () => ipcRenderer.invoke('start-workbuddy')
});
