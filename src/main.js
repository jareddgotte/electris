'use strict'

const {app, BrowserWindow} = require('electron')

// Enable hot reloading
// require('electron-reload')(path.join(__dirname, '../built'))

// Keep a global reference of the window object, otherwise the window will be
// closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
  // Create the browser window.
  mainWindow = new BrowserWindow({frame: false, width: 760, height: 620})

  // Open the DevTools.
  mainWindow.webContents.openDevTools()

  // Load the index.html of the app.
  const fileName = `file://${__dirname}/index.html`
  mainWindow.loadURL(fileName)

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object in case we store windows in an array to
    // support multi windows later (then delete the corresponding element).
    mainWindow = null
  })
}

// Called when Electron has finished initialization and is ready to create
// browser windows. Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X, it is common for applications and their menu bar to stay active
  // until the user quits explicitly with Cmd + Q.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On OS X, it's common to re-create a window in the app when the dock icon is
  // clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})
