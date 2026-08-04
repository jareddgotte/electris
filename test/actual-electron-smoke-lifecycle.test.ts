import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

describe('actual Electron smoke lifecycle', () => {
  it('exits successfully only after the bridge has destroyed the smoke window', () => {
    const harness = fs.readFileSync(
        path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            'actual-electron-smoke.cjs'),
        'utf8')
    const harnessStart = harness.indexOf('async function runElectronHarness()')
    const harnessEnd = harness.indexOf('\nasync function waitFor(', harnessStart)
    const lifecycle = harness.slice(harnessStart, harnessEnd)
    const closeRequest = lifecycle.indexOf('window.electris.window.close()')
    const destroyedConfirmation = lifecycle.indexOf(
        'await waitFor(() => window.isDestroyed())')
    const successfulExit = lifecycle.indexOf('app.exit(0)')

    expect(closeRequest).toBeGreaterThan(-1)
    expect(destroyedConfirmation).toBeGreaterThan(closeRequest)
    expect(successfulExit).toBeGreaterThan(destroyedConfirmation)
    expect(lifecycle.slice(
        destroyedConfirmation + 'await waitFor(() => window.isDestroyed())'.length,
        successfulExit).trim()).toBe('')
    expect(lifecycle.match(/app\.exit\(0\)/g)).toHaveLength(1)
    expect(lifecycle.slice(successfulExit)).not.toContain('process.platform')
  })
})
