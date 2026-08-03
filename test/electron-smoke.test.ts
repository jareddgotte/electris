import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({
  render: vi.fn()
}))
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import zlib from 'zlib'

const deflate = promisify(zlib.deflate)
const inflate = promisify(zlib.inflate)

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
const windowController = {
  minimize: vi.fn(),
  close: vi.fn(),
  webContents: {openDevTools: vi.fn()},
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

describe('high-score persistence', () => {
  it('loads the legacy object-shaped file at the current userData path', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-smoke-'))
    appPaths = {
      appData: path.join(tmpRoot, 'app-data'),
      userData: path.join(tmpRoot, 'user-data')
    }
    await fs.mkdir(appPaths.userData, {recursive: true})
    await fs.writeFile(
        path.join(appPaths.userData, 'Electris.config.dat'),
        await deflate(Buffer.from(JSON.stringify({highScores: ['9', '8', 7, 6, 5, 4, 3, 2, 1, 0]}))))

    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()
    const scores = await store.load()

    expect(scores).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  })

  it('serializes overlapping saves and preserves the last write', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-smoke-'))
    appPaths = {
      appData: path.join(tmpRoot, 'app-data'),
      userData: path.join(tmpRoot, 'user-data')
    }

    await fs.mkdir(appPaths.userData, {recursive: true})
    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()
    const writeFileCalls: string[] = []
    let releaseFirstWrite: (() => void) | null = null
    const originalWriteFile = fs.writeFile.bind(fs) as typeof fs.writeFile
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      writeFileCalls.push(String(args[0]))
      if (writeFileCalls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve
        })
      }
      return originalWriteFile(...args)
    })

    const firstSave = store.save([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    for (let attempt = 0; attempt < 100 && writeFileCalls.length === 0; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    expect(writeFileCalls).toHaveLength(1)

    const secondSave = store.save([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])
    const releaseWrite = releaseFirstWrite as (() => void) | null
    if (typeof releaseWrite === 'function') releaseWrite()
    await Promise.all([firstSave, secondSave])

    writeFileSpy.mockRestore()

    const written = await fs.readFile(path.join(appPaths.userData, 'Electris.config.dat'))
    const decoded = JSON.parse((await inflate(written)).toString('utf8'))
    expect(decoded).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])
  })

  it('falls back to the zero list when data is malformed', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-smoke-'))
    appPaths = {
      appData: path.join(tmpRoot, 'app-data'),
      userData: path.join(tmpRoot, 'user-data')
    }
    await fs.mkdir(appPaths.userData, {recursive: true})
    await fs.writeFile(path.join(appPaths.userData, 'Electris.config.dat'), Buffer.from('not compressed data'))

    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()

    await expect(store.load()).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('IPC sender and external-link restrictions', () => {
  it('rejects unrelated senders and only opens reviewed destinations', async () => {
    const {registerElectrisIpcHandlers} = await import('../src/main/ipc')
    registerElectrisIpcHandlers()

    const minimize = handlers.get('electris:window:minimize')
    const openExternal = handlers.get('electris:external:open')
    const loadScores = handlers.get('electris:high-scores:load')
    if (!minimize || !openExternal || !loadScores) {
      throw new Error('Expected IPC handlers to be registered')
    }

    browserWindowFromWebContents.mockReturnValue(null)
    await expect(minimize({sender: {}, senderFrame: {}})).rejects.toThrow('Blocked request')

    browserWindowFromWebContents.mockReturnValue({} as any)
    await expect(openExternal({sender: {}, senderFrame: {}}, 'author')).resolves.toBeUndefined()
    await expect(openExternal({sender: {}, senderFrame: {}}, 'https://example.com')).rejects.toThrow('Blocked external destination')

    expect(shellOpenExternal).toHaveBeenCalledWith('https://www.jaredgotte.com/')
    await expect(loadScores({sender: {}, senderFrame: {}})).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
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
    ;(globalThis as any).document = {
      addEventListener: vi.fn((_name: string, handler: typeof clickHandler) => {
        clickHandler = handler
      })
    }
    ;(globalThis as any).window = {
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
  })
})
