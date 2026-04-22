const { app, BaseWindow, WebContentsView, shell, Menu, nativeTheme, ipcMain, Tray, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')

// ── Config ──────────────────────────────────────────────────────────────────
const PIKA_URL = 'https://pika.me'
const START_URL = 'https://pika.me/login'
const SIDEBAR_WIDTH = 72
const TITLEBAR_HEIGHT = 38
const MAX_SESSIONS = 20

// ── State ───────────────────────────────────────────────────────────────────
let win
let tray
let isQuitting = false
let sessions = []
let activeSessionId = null
let sidebarView = null
let closedSessions = [] // for ⌘⇧T reopen

const store = new Store({
  defaults: {
    windowBounds: { width: 1280, height: 860 },
    windowPosition: null,
    isMaximized: false,
  }
})

const sessionsFile = path.join(app.getPath('userData'), 'sessions.json')

// ── Session Persistence ─────────────────────────────────────────────────────
function loadPersistedSessions() {
  try {
    if (fs.existsSync(sessionsFile)) {
      const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'))
      if (data && data.sessions) {
        return data
      }
      // Legacy format: just an array
      if (Array.isArray(data)) {
        return { sessions: data, activeId: data[0]?.id || null }
      }
    }
  } catch (e) {}
  return { sessions: [{ id: '1', name: 'Chat 1', url: START_URL }], activeId: '1' }
}

function persistSessions() {
  try {
    const data = {
      sessions: sessions.map(s => ({
        id: s.id,
        name: s.name,
        url: safeGetURL(s) || START_URL
      })),
      activeId: activeSessionId
    }
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2))
  } catch (e) {}
}

// ── Safety Helpers ──────────────────────────────────────────────────────────
function safeGetURL(session) {
  try {
    if (session?.view?.webContents && !session.view.webContents.isDestroyed()) {
      return session.view.webContents.getURL()
    }
  } catch (e) {}
  return session?.url || START_URL
}

function isViewAlive(view) {
  try {
    return view && view.webContents && !view.webContents.isDestroyed()
  } catch (e) {
    return false
  }
}

// ── Layout ──────────────────────────────────────────────────────────────────
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

// ── Sidebar Communication ───────────────────────────────────────────────────
function notifySidebar() {
  if (isViewAlive(sidebarView)) {
    sidebarView.webContents.send('sessions-update', {
      sessions: sessions.map(s => ({ id: s.id, name: s.name })),
      activeId: activeSessionId
    })
  }
}

// ── Session Management ──────────────────────────────────────────────────────
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

  // External links → default browser
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

  // Error handling → show error page
  view.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    if (!isViewAlive(view)) return
    const errorPagePath = path.join(__dirname, 'renderer', 'error.html')
    view.webContents.loadFile(errorPagePath, {
      query: {
        code: String(errorCode),
        desc: errorDesc,
        url: validatedURL || url || START_URL
      }
    })
  })

  // Right-click context menu
  view.webContents.on('context-menu', (_event, params) => {
    buildContextMenu(view.webContents, params)
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

function closeSession(id) {
  if (sessions.length <= 1) return
  const idx = sessions.findIndex(s => s.id === id)
  if (idx === -1) return

  const session = sessions[idx]

  // Save for reopen (⌘⇧T)
  closedSessions.push({
    name: session.name,
    url: safeGetURL(session)
  })
  if (closedSessions.length > 10) closedSessions.shift()

  // Remove view safely
  try {
    win.contentView.removeChildView(session.view)
  } catch (e) {}
  if (isViewAlive(session.view)) {
    try { session.view.webContents.destroy() } catch (e) {}
  }

  sessions.splice(idx, 1)
  if (activeSessionId === id) {
    switchToSession(sessions[Math.max(0, idx - 1)].id)
  }
  notifySidebar()
  persistSessions()
}

function createNewSession() {
  if (sessions.length >= MAX_SESSIONS) return
  const id = Date.now().toString()
  const name = `Chat ${sessions.length + 1}`
  createSessionView(id, name, START_URL)
  switchToSession(id)
  layoutViews()
  notifySidebar()
  persistSessions()
}

function reopenClosedSession() {
  if (closedSessions.length === 0) return
  const last = closedSessions.pop()
  const id = Date.now().toString()
  createSessionView(id, last.name, last.url)
  switchToSession(id)
  layoutViews()
  notifySidebar()
  persistSessions()
}

// ── Context Menu ────────────────────────────────────────────────────────────
function buildContextMenu(webContents, params) {
  const menuItems = []

  if (params.linkURL) {
    menuItems.push(
      { label: 'Open Link in Browser', click: () => shell.openExternal(params.linkURL) },
      { label: 'Copy Link Address', click: () => { const { clipboard } = require('electron'); clipboard.writeText(params.linkURL) } },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'image') {
    menuItems.push(
      { label: 'Open Image in Browser', click: () => shell.openExternal(params.srcURL) },
      { label: 'Copy Image Address', click: () => { const { clipboard } = require('electron'); clipboard.writeText(params.srcURL) } },
      { type: 'separator' }
    )
  }

  if (params.selectionText) {
    menuItems.push(
      { label: 'Copy', role: 'copy' },
      { type: 'separator' }
    )
  }

  if (params.isEditable) {
    menuItems.push(
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select All', role: 'selectAll' },
      { type: 'separator' }
    )
  }

  if (params.selectionText) {
    menuItems.push(
      { label: `Look Up "${params.selectionText.slice(0, 20)}${params.selectionText.length > 20 ? '…' : ''}"`,
        click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`) },
    )
  }

  menuItems.push(
    { type: 'separator' },
    { label: 'Reload', click: () => { if (!webContents.isDestroyed()) webContents.reload() } },
    { label: 'Back', enabled: webContents.canGoBack(), click: () => webContents.goBack() },
    { label: 'Forward', enabled: webContents.canGoForward(), click: () => webContents.goForward() },
  )

  const menu = Menu.buildFromTemplate(menuItems)
  menu.popup()
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  nativeTheme.themeSource = 'dark'

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const savedBounds = store.get('windowBounds')
  const savedPosition = store.get('windowPosition')

  const winWidth = Math.min(savedBounds.width, screenW)
  const winHeight = Math.min(savedBounds.height, screenH)

  const winOpts = {
    width: winWidth,
    height: winHeight,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    icon: path.join(__dirname, 'build', 'icon.icns'),
    show: false,
  }

  // Restore position if valid (still on-screen)
  if (savedPosition) {
    const { x, y } = savedPosition
    const displays = screen.getAllDisplays()
    const onScreen = displays.some(d => {
      const b = d.bounds
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    })
    if (onScreen) {
      winOpts.x = x
      winOpts.y = y
    }
  }

  win = new BaseWindow(winOpts)

  if (store.get('isMaximized')) {
    win.maximize()
  }

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
  for (const s of saved.sessions) {
    createSessionView(s.id, s.name, s.url)
  }

  // Restore active session or fall back to first
  const restoreId = saved.activeId && sessions.find(s => s.id === saved.activeId)
    ? saved.activeId
    : sessions[0]?.id
  if (restoreId) {
    switchToSession(restoreId)
  }

  layoutViews()

  // Layout on resize
  win.on('resize', () => {
    layoutViews()
    if (!win.isMaximized()) {
      const [w, h] = win.getSize()
      store.set('windowBounds', { width: w, height: h })
    }
  })
  win.on('maximize', () => {
    layoutViews()
    store.set('isMaximized', true)
  })
  win.on('unmaximize', () => {
    layoutViews()
    store.set('isMaximized', false)
  })
  win.on('moved', () => {
    if (!win.isMaximized()) {
      const [x, y] = win.getPosition()
      store.set('windowPosition', { x, y })
    }
  })

  // Hide to tray on close (macOS)
  win.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault()
      win.hide()
    }
  })
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-sessions', () => ({
  sessions: sessions.map(s => ({ id: s.id, name: s.name })),
  activeId: activeSessionId
}))

ipcMain.on('switch-session', (_, id) => {
  switchToSession(id)
})

ipcMain.on('new-session', () => {
  createNewSession()
})

ipcMain.on('close-session', (_, id) => {
  closeSession(id)
})

ipcMain.on('rename-session', (_, { id, name }) => {
  const session = sessions.find(s => s.id === id)
  if (session) {
    session.name = name
    notifySidebar()
    persistSessions()
  }
})

ipcMain.on('reorder-sessions', (_, orderedIds) => {
  const reordered = orderedIds
    .map(id => sessions.find(s => s.id === id))
    .filter(Boolean)
  // Keep any sessions not in the list (shouldn't happen but safe)
  const remaining = sessions.filter(s => !orderedIds.includes(s.id))
  sessions = [...reordered, ...remaining]
  notifySidebar()
  persistSessions()
})

// Retry from error page
ipcMain.on('retry-load', (_, url) => {
  const session = sessions.find(s => s.id === activeSessionId)
  if (session && isViewAlive(session.view)) {
    session.view.webContents.loadURL(url || START_URL)
  }
})

// ── Tray ────────────────────────────────────────────────────────────────────
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

// ── Application Menu ────────────────────────────────────────────────────────
function buildMenu() {
  const sessionSwitchItems = Array.from({ length: 9 }, (_, i) => ({
    label: `Session ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => {
      if (sessions[i]) switchToSession(sessions[i].id)
    }
  }))

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'New Session', accelerator: 'CmdOrCtrl+T', click: () => createNewSession() },
        { label: 'Close Session', accelerator: 'CmdOrCtrl+W', click: () => {
          if (activeSessionId) closeSession(activeSessionId)
        }},
        { label: 'Reopen Closed Session', accelerator: 'CmdOrCtrl+Shift+T', click: () => reopenClosedSession() },
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
          if (s && isViewAlive(s.view)) s.view.webContents.reload()
        }},
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Sessions',
      submenu: [
        ...sessionSwitchItems,
        { type: 'separator' },
        { label: 'Next Session', accelerator: 'Ctrl+Tab', click: () => {
          const idx = sessions.findIndex(s => s.id === activeSessionId)
          if (idx >= 0 && sessions.length > 1) {
            switchToSession(sessions[(idx + 1) % sessions.length].id)
          }
        }},
        { label: 'Previous Session', accelerator: 'Ctrl+Shift+Tab', click: () => {
          const idx = sessions.findIndex(s => s.id === activeSessionId)
          if (idx >= 0 && sessions.length > 1) {
            switchToSession(sessions[(idx - 1 + sessions.length) % sessions.length].id)
          }
        }},
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]))
}

// ── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu()
  createWindow()
  createTray()
  app.on('activate', () => { win?.show(); win?.focus() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { isQuitting = true; persistSessions() })
