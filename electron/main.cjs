// Electron main process — runs the built dashboard as a standalone desktop app.
// Serves the production build (../dist) from a fixed localhost port (stable origin
// so saved data / localStorage persists), then loads it in its own window.
// No browser, no external dev server.
const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PUBLIC = path.join(ROOT, 'public')
const PORT = 51703
const APP_ID = 'com.lucas.investments-dashboard'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

function startServer () {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      if (urlPath === '/') urlPath = '/index.html'

      // Serve recommendations.json live from /public so the AI refresh workflow
      // shows up without rebuilding the app.
      let filePath
      if (urlPath === '/recommendations.json' && fs.existsSync(path.join(PUBLIC, 'recommendations.json'))) {
        filePath = path.join(PUBLIC, 'recommendations.json')
      } else {
        filePath = path.normalize(path.join(DIST, urlPath))
      }

      // Block path traversal outside the served folders.
      if (!filePath.startsWith(DIST) && !filePath.startsWith(PUBLIC)) {
        res.writeHead(403); res.end('Forbidden'); return
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA fallback — serve index.html for unknown routes.
          fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
            if (e2) { res.writeHead(404); res.end('Not found') }
            else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(idx) }
          })
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.on('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

let win
async function createWindow () {
  try {
    await startServer()
  } catch (e) {
    // Port busy (app already running elsewhere) — load it anyway.
    console.error('Static server error:', e.message)
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b1020',
    title: 'Investments Dashboard',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  Menu.setApplicationMenu(null)
  win.setMenuBarVisibility(false)
  win.loadURL('http://127.0.0.1:' + PORT)

  // Open any external links in the user's real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:' + PORT)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}
