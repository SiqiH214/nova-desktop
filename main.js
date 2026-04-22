const { app, BaseWindow, WebContentsView, shell, Menu, nativeTheme, ipcMain, Tray, screen } = require('electron')
const path = require('path')
const fs = require('fs')

const PIKA_URL = 'https://pika.me'
const START_URL = 'https://pika.me/login'
const SIDEBAR_WIDTH = 72
const TITLEBAR_HEIGHT = 38

let win
let tray
let isQuitting = false
let sessions = []
let activeSessionId = null
let sidebarView = null

const sessionsFile = path.join(app.getPath('userData'), 'sessions.json')

function loadPersistedSessions() {
  try {
    if (fs.existsSync(sessionsFile)) {
      return JSON.parse(fs.readFileSync(sessionsFile, 'utf8'))
    }
  } catch (e) {}
  return [{ id: '1', name: 'Chat 1', url: START_URL }]
}

function persistSessions() {
  const data = sessions.map(s => ({
    id: s.id,
    name: s.name,
    url: s.view?.webContents?.getURL() || START_URL
  }))
  fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2))
}

function getWindowSize() {
  return win ? win.getSize() : [1280, 860]
}

function layoutViews() {
  const [w, h] = getWindowSize()
  if (sidebarView) {
    sidebarView.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height: h })
  }
  for (const session of sessions) {
    if (session.view) {
      const isActive = session.id === activeSessionId
      session.view.setVisible(isActive)
      if (isActive) {
        session.view.setBounds({
          x: SIDEBAR_WIDTH,
          y: TITLEBAR_HEIGHT,
          width: w - SIDEBAR_WIDTH,
          height: h - TITLEBAR_HEIGHT
        })
      }
    }
  }
}

function notifySidebar() {
  if (sidebarView?.webContents && !sidebarView.webContents.isDestroyed()) {
    sidebarView.webContents.send('sessions-update', {
      sessions: sessions.map(s => ({ id: s.id, name: s.name })),
      activeId: activeSessionId
    })
  }
}

function createSessionView(id, name, url) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  win.contentView.addChildView(view)
  view.webContents.loadURL(url || START_URL)
  view.setVisible(false)

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(PIKA_URL)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  view.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith(PIKA_URL)) {
      event.preventDefault()
      shell.openExternal(navUrl)
    }
  })

  view.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.loadURL(url || START_URL)
      }
    }, 3000)
  })

  const session = { id, name, view, url }
  sessions.push(session)
  return session
}

function switchToSession(id) {
  activeSessionId = id
  layoutViews()
  notifySidebar()
}

function createWindow() {
  nativeTheme.themeSource = 'dark'

  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const winWidth = Math.min(1280, width)
  const winHeight = Math.min(860, height)

  win = new BaseWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    icon: path.join(__dirname, 'build', 'icon.icns'),
    show: false,
  })

  // Sidebar
  sidebarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-sidebar.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  win.contentView.addChildView(sidebarView)
  sidebarView.webContents.loadFile(path.join(__dirname, 'renderer', 'sidebar.html'))
  sidebarView.webContents.once('did-finish-load', () => {
    win.show()
    notifySidebar()
  })

  // Load persisted sessions
  const saved = loadPersistedSessions()
  for (const s of saved) {
    createSessionView(s.id, s.name, s.url)
  }
  if (sessions.length > 0) {
    switchToSession(sessions[0].id)
  }

  layoutViews()

  win.on('resize', layoutViews)
  win.on('maximize', layoutViews)
  win.on('unmaximize', layoutViews)

  win.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault()
      win.hide()
    }
  })
}

// IPC
ipcMain.handle('get-sessions', () => ({
  sessions: sessions.map(s => ({ id: s.id, name: s.name })),
  activeId: activeSessionId
}))

ipcMain.on('switch-session', (_, id) => {
  switchToSession(id)
})

ipcMain.on('new-session', () => {
  const id = Date.now().toString()
  const name = `Chat ${sessions.length + 1}`
  createSessionView(id, name, START_URL)
  switchToSession(id)
  layoutViews()
  notifySidebar()
  persistSessions()
})

ipcMain.on('close-session', (_, id) => {
  if (sessions.length <= 1) return
  const idx = sessions.findIndex(s => s.id === id)
  if (idx === -1) return
  const session = sessions[idx]
  win.contentView.removeChildView(session.view)
  session.view.webContents.destroy()
  sessions.splice(idx, 1)
  if (activeSessionId === id) {
    switchToSession(sessions[Math.max(0, idx - 1)].id)
  }
  notifySidebar()
  persistSessions()
})

ipcMain.on('rename-session', (_, { id, name }) => {
  const session = sessions.find(s => s.id === id)
  if (session) {
    session.name = name
    notifySidebar()
    persistSessions()
  }
})

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.png'))
  tray.setToolTip('Pika')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Pika', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
  ]))
  tray.on('click', () => {
    if (win) win.isVisible() ? win.hide() : (win.show(), win.focus())
  })
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'New Session', accelerator: 'CmdOrCtrl+T', click: () => ipcMain.emit('new-session') },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => {
          const s = sessions.find(x => x.id === activeSessionId)
          s?.view?.webContents?.reload()
        }},
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]))
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  createTray()
  app.on('activate', () => { win?.show(); win?.focus() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { isQuitting = true; persistSessions() })
