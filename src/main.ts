import { app } from 'electron'
import path from 'path'
import { registerElectrisIpcHandlers } from './main/ipc'
import { createElectrisWindow } from './main/window'
import { HighScoreStore } from './main/high-scores'

let mainWindow: import('electron').BrowserWindow | null = null
const highScoreStore = new HighScoreStore()

registerElectrisIpcHandlers(highScoreStore)

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  mainWindow = createElectrisWindow(preloadPath)
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'))

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
