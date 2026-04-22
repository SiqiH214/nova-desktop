const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sidebar', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  switchSession: (id) => ipcRenderer.send('switch-session', id),
  newSession: () => ipcRenderer.send('new-session'),
  closeSession: (id) => ipcRenderer.send('close-session', id),
  renameSession: (id, name) => ipcRenderer.send('rename-session', { id, name }),
  reorderSessions: (orderedIds) => ipcRenderer.send('reorder-sessions', orderedIds),
  onUpdate: (cb) => ipcRenderer.on('sessions-update', (_, data) => cb(data)),
})
