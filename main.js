const { app, BrowserWindow, shell, Menu, nativeTheme, ipcMain, Tray } = require('electron')
const path = require('path')

const PIKA_URL = 'https://pika.me'
const START_URL = 'https://pika.me/login'

let mainWindow
let tray
let isQuitting = false

function createWindow() {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(__dirname, 'build', 'icon.icns'),
    show: false,
  })

  // Load login page directly (skip landing)
  mainWindow.loadURL(START_URL)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    // Focus window on launch
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // Handle failed loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
    // Retry after 3 seconds
    setTimeout(() => {
      mainWindow.loadURL(START_URL)
    }, 3000)
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(PIKA_URL)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Handle external navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(PIKA_URL)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray() {
  // Use a simple emoji-based tray icon (macOS supports this)
  // In production, you'd use a proper icon file
  tray = new Tray(path.join(__dirname, 'build', 'icon.png'))
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Pika', click: () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => {
      isQuitting = true
      app.quit()
    }}
  ])
  
  tray.setToolTip('Pika')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      createWindow()
    }
  })
}

// Native Mac menu
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

// Handle deep links (pika://)
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('pika://')) {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      // Navigate to the deep link path
      const path = url.replace('pika://', '')
      mainWindow.loadURL(`${PIKA_URL}/${path}`)
    }
  }
})
