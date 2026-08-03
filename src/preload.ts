import { contextBridge, ipcRenderer } from 'electron'
import type { ElectrisBridge, ElectrisExternalDestination, HighScoreList } from './electris'

const electrisBridge: ElectrisBridge = {
  window: {
    minimize: () => ipcRenderer.invoke('electris:window:minimize'),
    close: () => ipcRenderer.invoke('electris:window:close')
  },
  openExternal: (destination: ElectrisExternalDestination) =>
    ipcRenderer.invoke('electris:external:open', destination),
  highScores: {
    load: () => ipcRenderer.invoke('electris:high-scores:load') as Promise<HighScoreList>,
    save: (highScores: HighScoreList) =>
      ipcRenderer.invoke('electris:high-scores:save', highScores)
  }
}

contextBridge.exposeInMainWorld('electris', electrisBridge)
