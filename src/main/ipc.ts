import { BrowserWindow, ipcMain, shell } from 'electron'
import { ELECTRIS_EXTERNAL_DESTINATIONS, type ElectrisExternalDestination, type HighScoreList } from '../electris'
import { HighScoreStore } from './high-scores'

export type ElectrisIpcHandlers = {
  loadHighScores(): Promise<HighScoreList>
  saveHighScores(highScores: HighScoreList): Promise<void>
}

const externalDestinations: Record<ElectrisExternalDestination, string> = {
  author: 'https://www.jaredgotte.com/',
  license: 'https://opensource.org/licenses/ISC'
}

function isElectrisDestination(value: unknown): value is ElectrisExternalDestination {
  return ELECTRIS_EXTERNAL_DESTINATIONS.includes(value as ElectrisExternalDestination)
}

function assertElectrisWindow(window: BrowserWindow | null, sender: Electron.WebContents) {
  const senderWindow = BrowserWindow.fromWebContents(sender)
  if (!window || senderWindow !== window) {
    throw new Error('Blocked request from an unrelated sender')
  }
}

export function registerElectrisIpcHandlers(
    mainWindow: BrowserWindow,
    highScoreStore = new HighScoreStore()): ElectrisIpcHandlers {
  ipcMain.handle('electris:window:minimize', async (event) => {
    assertElectrisWindow(mainWindow, event.sender)
    mainWindow.minimize()
  })

  ipcMain.handle('electris:window:close', async (event) => {
    assertElectrisWindow(mainWindow, event.sender)
    mainWindow.close()
  })

  ipcMain.handle('electris:external:open', async (event, destination: unknown) => {
    assertElectrisWindow(mainWindow, event.sender)
    if (!isElectrisDestination(destination)) {
      throw new Error('Blocked external destination request')
    }

    await shell.openExternal(externalDestinations[destination])
  })

  ipcMain.handle('electris:high-scores:load', async (event) => {
    assertElectrisWindow(mainWindow, event.sender)
    return highScoreStore.load()
  })

  ipcMain.handle('electris:high-scores:save', async (event, highScores: HighScoreList) => {
    assertElectrisWindow(mainWindow, event.sender)
    await highScoreStore.save(highScores)
  })

  return {
    loadHighScores: () => highScoreStore.load(),
    saveHighScores: (highScores: HighScoreList) => highScoreStore.save(highScores)
  }
}
