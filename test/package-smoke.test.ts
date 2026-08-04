import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { smokeLaunch } = require('../scripts/package-smoke.cjs') as {
  smokeLaunch: (
    executable: string,
    userDataPath: string,
    mode: string,
    operations: Record<string, unknown>
  ) => Promise<unknown>
}

describe('package smoke process lifecycle', () => {
  it('reports asynchronous spawn failure and completes bounded cleanup', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter()
    })
    const stopProcess = vi.fn()
    const waitForExit = vi.fn().mockResolvedValue(undefined)
    const started = Date.now()

    const failure = smokeLaunch('/missing/electris', '/isolated/user-data', 'write', {
      reservePort: async () => 12345,
      launchCommand: () => ({command: '/missing/electris', args: []}),
      spawnProcess: () => {
        queueMicrotask(() => child.emit('error', new Error('spawn EACCES')))
        return child
      },
      stopProcess,
      waitForExit
    })

    await expect(failure).rejects.toThrow(
        /Could not launch packaged Electron:.*spawn EACCES[\s\S]*\[spawn error\]/)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(stopProcess.mock.calls).toEqual([
      [child, 'SIGTERM'],
      [child, 'SIGKILL']
    ])
    expect(waitForExit).toHaveBeenCalledOnce()
    expect(waitForExit).toHaveBeenCalledWith(child)
  })
})
