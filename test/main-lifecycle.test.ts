import { beforeEach, describe, expect, it, vi } from 'vitest'

const appCallbacks = new Map<string, () => void>()
const handleCalls: string[] = []
const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const createdWindows: Array<{
  loadFile: ReturnType<typeof vi.fn>
  webContents: {openDevTools: ReturnType<typeof vi.fn>}
  on: ReturnType<typeof vi.fn>
}> = []

const BrowserWindowMock = vi.fn(function BrowserWindowMock(this: any) {
  this.loadFile = vi.fn().mockResolvedValue(undefined)
  this.webContents = {openDevTools: vi.fn()}
  this.on = vi.fn((event: string, handler: () => void) => {
    if (event === 'closed') this.closedHandler = handler
  })
  createdWindows.push(this)
})

vi.mock('electron', () => ({
  app: {
    on: vi.fn((event: string, handler: () => void) => {
      appCallbacks.set(event, handler)
    }),
    quit: vi.fn()
  },
  BrowserWindow: Object.assign(BrowserWindowMock, {
    fromWebContents: vi.fn()
  }),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      if (registeredHandlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      registeredHandlers.set(channel, handler)
      handleCalls.push(channel)
    })
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined)
  }
}))

beforeEach(() => {
  appCallbacks.clear()
  handleCalls.length = 0
  registeredHandlers.clear()
  createdWindows.length = 0
  BrowserWindowMock.mockClear()
  vi.resetModules()
})

describe('main process lifecycle', () => {
  it('keeps IPC registration single-shot across macOS reopen flows', async () => {
    await import('../src/main')

    expect(handleCalls).toEqual([
      'electris:window:minimize',
      'electris:window:close',
      'electris:external:open',
      'electris:high-scores:load',
      'electris:high-scores:save'
    ])

    const ready = appCallbacks.get('ready')
    const activate = appCallbacks.get('activate')
    expect(ready).toBeDefined()
    expect(activate).toBeDefined()

    ready?.()
    expect(createdWindows).toHaveLength(1)

    const firstWindow = createdWindows[0]
    expect(firstWindow.loadFile).toHaveBeenCalledTimes(1)
    expect(firstWindow.webContents.openDevTools).not.toHaveBeenCalled()

    const closedHandler = firstWindow.on.mock.calls.find(([event]) => event === 'closed')?.[1]
    expect(closedHandler).toBeTypeOf('function')
    closedHandler?.()

    activate?.()
    expect(createdWindows).toHaveLength(2)
    expect(createdWindows[1].loadFile).toHaveBeenCalledTimes(1)
    expect(handleCalls).toHaveLength(5)
  })
})
