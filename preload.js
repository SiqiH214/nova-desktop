const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pikaDesktop', {
  version: '1.0.0',
  platform: process.platform,
  retryLoad: (url) => ipcRenderer.send('retry-load', url),
})
