// Preload script — minimal, just expose app version
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pikaDesktop', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
})
