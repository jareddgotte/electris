import { app, BrowserWindow } from 'electron'

// Keep a global reference of the window object, otherwise the window will be
// closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null = null

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    frame:  false,
    width:  760,
    height: 620
  })

  // Load the index.html of the app.
  mainWindow.loadURL(`file://${__dirname}/renderer.html`)

  // Open the DevTools if in "development mode."
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object in case we store windows in an array to
    // support multi windows later (then delete the corresponding element).
    mainWindow = null
  })
}

// Called when Electron has finished initialization and is ready to create
// browser windows. Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X, it is common for applications and their menu bar to stay active
  // until the user quits explicitly with Cmd + Q.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X, it's common to re-create a window in the app when the dock icon is
  // clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})
