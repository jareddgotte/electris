import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({
  render: vi.fn()
}))
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
const exposedValues: Record<string, unknown> = {}
const browserWindowFromWebContents = vi.fn()
const shellOpenExternal = vi.fn().mockResolvedValue(undefined)
const ipcInvoke = vi.fn()
const ipcHandles = vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
})
const contextBridgeExpose = vi.fn((name: string, value: unknown) => {
  exposedValues[name] = value
})
const webContentsListeners = new Map<string, (...args: any[]) => void>()
let windowOpenHandler: ((details: {url: string}) => {action: string}) | undefined
const windowController = {
  minimize: vi.fn(),
  close: vi.fn(),
  webContents: {
    openDevTools: vi.fn(),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      webContentsListeners.set(event, listener)
    }),
    setWindowOpenHandler: vi.fn((handler: typeof windowOpenHandler) => {
      windowOpenHandler = handler
    })
  },
  on: vi.fn()
}
const BrowserWindowMock = vi.fn(function BrowserWindowMock(this: any, options: unknown) {
  this.options = options
  this.minimize = windowController.minimize
  this.close = windowController.close
  this.webContents = windowController.webContents
  this.on = windowController.on
})
const GameMock = vi.fn(function GameMock(this: any) {
  this.created = true
})

let appPaths = {
  appData: '',
  userData: ''
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => appPaths[name as keyof typeof appPaths],
    isReady: () => true,
    on: vi.fn(),
    quit: vi.fn()
  },
  BrowserWindow: Object.assign(BrowserWindowMock, {
    fromWebContents: browserWindowFromWebContents
  }),
  ipcMain: {
    handle: ipcHandles
  },
  shell: {
    openExternal: shellOpenExternal
  },
  contextBridge: {
    exposeInMainWorld: contextBridgeExpose
  },
  ipcRenderer: {
    invoke: ipcInvoke
  }
}))

vi.mock('../src/js/game', () => ({
  Game: GameMock
}))

beforeEach(() => {
  handlers.clear()
  for (const key of Object.keys(exposedValues)) delete exposedValues[key]
  browserWindowFromWebContents.mockReset()
  shellOpenExternal.mockClear()
  ipcInvoke.mockReset()
  ipcHandles.mockClear()
  contextBridgeExpose.mockClear()
  BrowserWindowMock.mockClear()
  windowController.minimize.mockClear()
  windowController.close.mockClear()
  windowController.webContents.openDevTools.mockClear()
  windowController.webContents.on.mockClear()
  windowController.webContents.setWindowOpenHandler.mockClear()
  webContentsListeners.clear()
  windowOpenHandler = undefined
  windowController.on.mockClear()
  appPaths = {appData: '', userData: ''}
})

afterEach(() => {
  vi.resetModules()
})

describe('window security and preload contracts', () => {
  it('builds an isolated BrowserWindow configuration', async () => {
    const {createElectrisWindowOptions} = await import('../src/main/window')
    const options = createElectrisWindowOptions('/tmp/preload.js')

    expect(options).toEqual(expect.objectContaining({
      frame: false,
      width: 760,
      height: 620,
      webPreferences: expect.objectContaining({
        preload: '/tmp/preload.js',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false
      })
    }))
  })

  it('allows only the packaged renderer URL and denies redirects and new windows', async () => {
    const rendererPath = path.join(os.tmpdir(), 'electris', 'renderer.html')
    const rendererUrl = pathToFileURL(rendererPath).href
    const {createElectrisWindow} = await import('../src/main/window')

    createElectrisWindow('/tmp/preload.js', rendererPath)

    const navigate = webContentsListeners.get('will-navigate')
    const redirect = webContentsListeners.get('will-redirect')
    expect(navigate).toBeDefined()
    expect(redirect).toBeDefined()
    expect(windowOpenHandler).toBeDefined()

    const allowedEvent = {preventDefault: vi.fn()}
    navigate?.(allowedEvent, rendererUrl)
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()

    for (const deniedUrl of [
      'https://www.jaredgotte.com/',
      'http://www.jaredgotte.com/',
      pathToFileURL(path.join(os.tmpdir(), 'electris', 'other.html')).href,
      'javascript:alert(1)',
      'data:text/html,unexpected',
      'not a valid URL'
    ]) {
      const deniedEvent = {preventDefault: vi.fn()}
      navigate?.(deniedEvent, deniedUrl)
      expect(deniedEvent.preventDefault).toHaveBeenCalledOnce()
    }

    const redirectEvent = {preventDefault: vi.fn()}
    redirect?.(redirectEvent, rendererUrl)
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce()

    for (const popupUrl of [
      rendererUrl,
      'https://www.jaredgotte.com/',
      'https://opensource.org/licenses/ISC'
    ]) {
      expect(windowOpenHandler?.({url: popupUrl})).toEqual({action: 'deny'})
    }
  })

  it('exposes only the typed preload bridge channels', async () => {
    ipcInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'electris:high-scores:load':
          return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        default:
          return {channel, args}
      }
    })

    await import('../src/preload')

    expect(contextBridgeExpose).toHaveBeenCalledWith('electris', expect.any(Object))
    const electris = exposedValues.electris as {
      window: {minimize(): Promise<void>; close(): Promise<void>}
      openExternal(destination: string): Promise<void>
      highScores: {
        load(): Promise<number[]>
        save(highScores: number[]): Promise<void>
      }
    }

    await electris.window.minimize()
    await electris.window.close()
    await electris.openExternal('author')
    await electris.highScores.load()
    await electris.highScores.save([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])

    expect(ipcInvoke).toHaveBeenCalledWith('electris:window:minimize')
    expect(ipcInvoke).toHaveBeenCalledWith('electris:window:close')
    expect(ipcInvoke).toHaveBeenCalledWith('electris:external:open', 'author')
    expect(ipcInvoke).toHaveBeenCalledWith('electris:high-scores:load')
    expect(ipcInvoke).toHaveBeenCalledWith(
      'electris:high-scores:save',
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    )
  })
})

describe('IPC sender and external-link restrictions', () => {
  it('rejects every privileged operation from any non-Electris window', async () => {
    const sender = {}
    const electrisWindow = {
      minimize: vi.fn(),
      close: vi.fn(),
      webContents: sender
    }
    const unrelatedWindow = {
      minimize: vi.fn(),
      close: vi.fn(),
      webContents: {}
    }
    const highScoreStore = {
      load: vi.fn().mockResolvedValue([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
      save: vi.fn().mockResolvedValue(undefined)
    }
    const {registerElectrisIpcHandlers} = await import('../src/main/ipc')
    registerElectrisIpcHandlers(highScoreStore as any, () => electrisWindow as any)

    browserWindowFromWebContents.mockReturnValue(unrelatedWindow)
    const requests: Array<[string, ...unknown[]]> = [
      ['electris:window:minimize'],
      ['electris:window:close'],
      ['electris:external:open', 'author'],
      ['electris:high-scores:load'],
      ['electris:high-scores:save', [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]]
    ]

    for (const [channel, ...args] of requests) {
      const handler = handlers.get(channel)
      expect(handler).toBeDefined()
      await expect(handler?.({sender: unrelatedWindow.webContents}, ...args))
          .rejects.toThrow('Blocked request from an unrelated sender')
    }

    browserWindowFromWebContents.mockReturnValue(null)
    await expect(handlers.get('electris:window:minimize')?.({sender}))
        .rejects.toThrow('Blocked request from an unrelated sender')
    expect(electrisWindow.minimize).not.toHaveBeenCalled()
    expect(electrisWindow.close).not.toHaveBeenCalled()
    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(highScoreStore.load).not.toHaveBeenCalled()
    expect(highScoreStore.save).not.toHaveBeenCalled()
  })

  it('allows only the designated window and validates destinations and scores', async () => {
    const sender = {}
    const electrisWindow = {
      minimize: vi.fn(),
      close: vi.fn(),
      webContents: sender
    }
    const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    const highScoreStore = {
      load: vi.fn().mockResolvedValue(scores),
      save: vi.fn().mockResolvedValue(undefined)
    }
    const {registerElectrisIpcHandlers} = await import('../src/main/ipc')
    registerElectrisIpcHandlers(highScoreStore as any, () => electrisWindow as any)
    browserWindowFromWebContents.mockReturnValue(electrisWindow)
    const event = {sender}

    await expect(handlers.get('electris:window:minimize')?.(event)).resolves.toBeUndefined()
    await expect(handlers.get('electris:window:close')?.(event)).resolves.toBeUndefined()
    await expect(handlers.get('electris:external:open')?.(event, 'author')).resolves.toBeUndefined()
    await expect(handlers.get('electris:external:open')?.(event, 'license')).resolves.toBeUndefined()
    await expect(handlers.get('electris:high-scores:load')?.(event)).resolves.toEqual(scores)
    await expect(handlers.get('electris:high-scores:save')?.(event, scores)).resolves.toBeUndefined()

    expect(electrisWindow.minimize).toHaveBeenCalledOnce()
    expect(electrisWindow.close).toHaveBeenCalledOnce()
    expect(shellOpenExternal).toHaveBeenNthCalledWith(1, 'https://www.jaredgotte.com/')
    expect(shellOpenExternal).toHaveBeenNthCalledWith(2, 'https://opensource.org/licenses/ISC')
    expect(highScoreStore.save).toHaveBeenCalledWith(scores)

    for (const invalidDestination of ['unknown', 'http://www.jaredgotte.com/']) {
      await expect(handlers.get('electris:external:open')?.(event, invalidDestination))
          .rejects.toThrow('Blocked external destination')
    }
    for (const invalidScores of [
      [1, 2],
      [-1, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      [Infinity, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']
    ]) {
      await expect(handlers.get('electris:high-scores:save')?.(event, invalidScores))
          .rejects.toThrow('Blocked invalid high-score request')
    }
    expect(shellOpenExternal).toHaveBeenCalledTimes(2)
    expect(highScoreStore.save).toHaveBeenCalledTimes(1)
  })
})

describe('renderer bridge actions', () => {
  it('suppresses rejected openExternal and window control promises', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(globalThis as any).document = {
      addEventListener: vi.fn(),
      getElementById: vi.fn(() => ({}))
    }
    ;(globalThis as any).window = {
      electris: {
        openExternal: vi.fn().mockRejectedValue(new Error('blocked external link')),
        window: {
          minimize: vi.fn().mockRejectedValue(new Error('blocked minimize')),
          close: vi.fn().mockRejectedValue(new Error('blocked close'))
        },
        highScores: {
          load: vi.fn().mockResolvedValue([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
          save: vi.fn().mockResolvedValue(undefined)
        }
      }
    }

    const {openElectrisExternal} = await import('../src/js/tetris')
    const {invokeTopRightButtonAction} = await import('../src/renderer')

    await expect(openElectrisExternal('author')).resolves.toBeUndefined()
    await expect(invokeTopRightButtonAction('minimize')).resolves.toBeUndefined()
    await expect(invokeTopRightButtonAction('close')).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledTimes(3)
    consoleError.mockRestore()
  })
})

describe('renderer bootstrap', () => {
  it('loads scores before constructing the game and wires persistence back through the bridge', async () => {
    const {Game} = await import('../src/js/game')
    const gameFactory = vi.mocked(Game)
    gameFactory.mockImplementation(function GameMock(this: any) {
      this.created = true
    })

    let clickHandler: ((event: {target: unknown; preventDefault(): void}) => void) | undefined
    class ElementMock {
      closest() {
        return {
          getAttribute: () => 'author'
        }
      }
    }
    ;(globalThis as any).Element = ElementMock
    ;(globalThis as any).document = {
      addEventListener: vi.fn((_name: string, handler: typeof clickHandler) => {
        clickHandler = handler
      })
    }
    const rendererUrl = 'file:///opt/electris/app/renderer.html'
    ;(globalThis as any).window = {
      location: {href: rendererUrl},
      electris: {
        highScores: {
          load: vi.fn().mockResolvedValue([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
          save: vi.fn().mockResolvedValue(undefined)
        },
        openExternal: vi.fn().mockResolvedValue(undefined),
        window: {
          minimize: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined)
        }
      }
    }

    const {bootstrapTetris} = await import('../src/js/tetris')
    await bootstrapTetris()

    expect(gameFactory).toHaveBeenCalledWith(
      'canvas',
      'high-scores-list',
      false,
      expect.objectContaining({
        highScores: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        persistHighScores: expect.any(Function)
      }))
    const createdOptions = gameFactory.mock.calls[0]?.[3] as {
      persistHighScores: (scores: number[]) => Promise<void> | void
    }
    await createdOptions.persistHighScores([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect((window as any).electris.highScores.save).toHaveBeenCalledWith([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1
    ])

    expect(clickHandler).toBeDefined()
    const preventDefault = vi.fn()
    clickHandler?.({target: new ElementMock(), preventDefault})
    expect(preventDefault).toHaveBeenCalledOnce()
    expect((window as any).electris.openExternal).toHaveBeenCalledWith('author')
    expect((window as any).location.href).toBe(rendererUrl)
    delete (globalThis as any).Element
  })
})
