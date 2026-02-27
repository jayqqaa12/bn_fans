const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startLogin: () => ipcRenderer.invoke('start-login'),
  startTask: (username) => ipcRenderer.invoke('start-task', username),
  stopTask: () => ipcRenderer.invoke('stop-task'),
  getTaskStatus: () => ipcRenderer.invoke('get-task-status'),
  
  onLoginSuccess: (callback) => {
    ipcRenderer.on('login-success', () => callback());
  },
  
  onTaskLog: (callback) => {
    ipcRenderer.on('task-log', (event, entry) => callback(entry));
  },
  
  onTaskStarted: (callback) => {
    ipcRenderer.on('task-started', () => callback());
  },
  
  onTaskStopped: (callback) => {
    ipcRenderer.on('task-stopped', () => callback());
  }
});
