// Preload script — safely expose APIs to renderer
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pikaDesktop', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  
  // Notifications
  showNotification: (title, body) => {
    new Notification(title, { body })
  }
})

// Listen for messages from main process
ipcRenderer.on('deep-link', (event, url) => {
  console.log('Deep link received:', url)
})
