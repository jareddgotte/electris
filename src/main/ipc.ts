import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  ELECTRIS_EXTERNAL_DESTINATIONS,
  parseHighScores,
  type ElectrisExternalDestination,
  type HighScoreList
} from '../electris'
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

function assertElectrisSender(
    sender: Electron.WebContents,
    getElectrisWindow: () => BrowserWindow | null) {
  const senderWindow = BrowserWindow.fromWebContents(sender)
  const electrisWindow = getElectrisWindow()
  if (!electrisWindow || senderWindow !== electrisWindow ||
      sender !== electrisWindow.webContents) {
    throw new Error('Blocked request from an unrelated sender')
  }

  return electrisWindow
}

export function registerElectrisIpcHandlers(
    highScoreStore: HighScoreStore,
    getElectrisWindow: () => BrowserWindow | null): ElectrisIpcHandlers {
  ipcMain.handle('electris:window:minimize', async (event) => {
    assertElectrisSender(event.sender, getElectrisWindow).minimize()
  })

  ipcMain.handle('electris:window:close', async (event) => {
    assertElectrisSender(event.sender, getElectrisWindow).close()
  })

  ipcMain.handle('electris:external:open', async (event, destination: unknown) => {
    assertElectrisSender(event.sender, getElectrisWindow)
    if (!isElectrisDestination(destination)) {
      throw new Error('Blocked external destination request')
    }

    await shell.openExternal(externalDestinations[destination])
  })

  ipcMain.handle('electris:high-scores:load', async (event) => {
    assertElectrisSender(event.sender, getElectrisWindow)
    const highScores = parseHighScores(await highScoreStore.load(), false)
    if (!highScores) throw new Error('Blocked invalid high-score response')
    return highScores
  })

  ipcMain.handle('electris:high-scores:save', async (event, value: unknown) => {
    assertElectrisSender(event.sender, getElectrisWindow)
    const highScores = parseHighScores(value, false)
    if (!highScores) throw new Error('Blocked invalid high-score request')
    await highScoreStore.save(highScores)
  })

  return {
    loadHighScores: () => highScoreStore.load(),
    saveHighScores: (highScores: HighScoreList) => highScoreStore.save(highScores)
  }
}
