import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

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

export function createElectrisWindow(preloadPath: string) {
  return new BrowserWindow(createElectrisWindowOptions(preloadPath))
}
