import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebContents
} from 'electron'
import { pathToFileURL } from 'url'

export function createElectrisWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    frame: false,
    width: 760,
    height: 620,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  }
}

export function installElectrisNavigationPolicy(
    webContents: WebContents,
    rendererPath: string) {
  const rendererUrl = pathToFileURL(rendererPath).href

  webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== rendererUrl) event.preventDefault()
  })
  webContents.on('will-redirect', (event) => {
    event.preventDefault()
  })
  webContents.setWindowOpenHandler(() => ({action: 'deny'}))
}

export function createElectrisWindow(preloadPath: string, rendererPath: string) {
  const electrisWindow = new BrowserWindow(createElectrisWindowOptions(preloadPath))
  installElectrisNavigationPolicy(electrisWindow.webContents, rendererPath)
  return electrisWindow
}
