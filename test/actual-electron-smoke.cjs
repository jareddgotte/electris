'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')

const expectedScores = [55, 34, 21, 13, 8, 5, 3, 2, 1, 0]

if (!process.versions.electron) {
  runCoordinator()
} else {
  void runElectronHarness()
}

function runCoordinator() {
  const electron = require('electron')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-electron-smoke-'))

  try {
    const first = launchElectron(electron, temporaryRoot, 'write')
    assert(first.exitCode === 0, `first Electron launch failed (${first.exitCode}):\n${first.output}`)
    assert(first.report.closed === true, 'close bridge did not close the Electris window')
    assert(first.report.startup.listLength === 10, 'the real game did not render ten high scores')
    assert(first.report.startup.canvasWidth === 200 && first.report.startup.canvasHeight === 400,
        'the real game did not initialize its canvas')
    assert(first.report.startup.requireType === 'undefined' && first.report.startup.processType === 'undefined',
        'Node globals leaked into the isolated renderer')
    assert(first.report.paths.userData.startsWith(temporaryRoot) &&
        first.report.paths.appData.startsWith(temporaryRoot) &&
        first.report.paths.userData !== first.report.paths.appData,
        'the smoke harness did not isolate both Electron persistence roots')
    assert(JSON.stringify(first.report.startup.bridgeKeys) === JSON.stringify(['highScores', 'openExternal', 'window']),
        'the preload exposed an unexpected top-level bridge surface')
    assert(JSON.stringify(first.report.loadedScores) === JSON.stringify(expectedScores),
        'scores did not round-trip through the real preload IPC bridge')
    assert(JSON.stringify(first.report.openedUrls) === JSON.stringify([
      'https://www.jaredgotte.com/',
      'https://opensource.org/licenses/ISC'
    ]), 'external bridge destinations were not mapped to the reviewed URLs')
    assert(first.report.errors.length === 0,
        `renderer/preload errors were reported: ${first.report.errors.join('; ')}`)

    const second = launchElectron(electron, temporaryRoot, 'read')
    assert(second.exitCode === 0, `second Electron launch failed (${second.exitCode}):\n${second.output}`)
    assert(JSON.stringify(second.report.loadedScores) === JSON.stringify(expectedScores),
        'scores did not survive an actual Electron restart')
    assert(second.report.startup.firstScore === String(expectedScores[0]),
        'the restarted game did not render the persisted high score')
    assert(second.report.closed === true, 'close bridge did not close the restarted window')
    assert(second.report.errors.length === 0,
        `restart reported renderer/preload errors: ${second.report.errors.join('; ')}`)

    console.log('Actual Electron smoke passed: isolated renderer startup, bridge controls, fixed external destinations, and score restart round-trip.')
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true})
  }
}

function launchElectron(electron, temporaryRoot, mode) {
  const reportPath = path.join(temporaryRoot, `${mode}-report.json`)
  const electronArgs = ['--disable-gpu', __filename]
  let command = electron
  let args = electronArgs

  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], {encoding: 'utf8'})
    if (xvfb.status !== 0) {
      throw new Error('Actual Electron smoke requires a display; DISPLAY is unset and xvfb-run is unavailable')
    }
    command = 'xvfb-run'
    args = ['-a', electron, ...electronArgs]
  }

  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 45000,
    env: {
      ...process.env,
      ELECTRIS_SMOKE_MODE: mode,
      ELECTRIS_SMOKE_REPORT: reportPath,
      ELECTRIS_SMOKE_USER_DATA: path.join(temporaryRoot, 'user-data')
    }
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.error) throw new Error(`Could not launch actual Electron: ${result.error.message}\n${output}`)
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : {errors: ['Electron exited without writing its smoke report']}
  return {exitCode: result.status, output, report}
}

async function runElectronHarness() {
  const {app, BrowserWindow, shell} = require('electron')
  const reportPath = process.env.ELECTRIS_SMOKE_REPORT
  const userDataPath = process.env.ELECTRIS_SMOKE_USER_DATA
  const mode = process.env.ELECTRIS_SMOKE_MODE
  const openedUrls = []
  const errors = []
  const report = {openedUrls, errors, closed: false}

  function writeReport() {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  }

  function fail(error) {
    errors.push(error instanceof Error ? error.stack || error.message : String(error))
    writeReport()
    app.exit(1)
  }

  app.setPath('userData', userDataPath)
  app.setPath('appData', path.join(path.dirname(userDataPath), 'app-data'))
  report.paths = {
    appData: app.getPath('appData'),
    userData: app.getPath('userData')
  }
  shell.openExternal = async (url) => {
    openedUrls.push(url)
  }

  require('../app/main.js')

  try {
    await app.whenReady()
    const window = await waitFor(() => BrowserWindow.getAllWindows()[0])
    window.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') errors.push(`renderer console: ${details.message}`)
    })
    window.webContents.on('preload-error', (_event, _preloadPath, error) => {
      errors.push(`preload: ${error.message}`)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      errors.push(`renderer gone: ${details.reason}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description) => {
      errors.push(`load failed (${code}): ${description}`)
    })

    const startup = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript(`({
        listLength: document.querySelectorAll('#high-scores-list li').length,
        firstScore: document.querySelector('#high-scores-list li')?.textContent || '',
        canvasWidth: document.querySelector('#canvas')?.width || 0,
        canvasHeight: document.querySelector('#canvas')?.height || 0,
        requireType: typeof require,
        processType: typeof process,
        bridgeKeys: Object.keys(window.electris || {}).sort()
      })`)
      return state.listLength === 10 ? state : null
    })
    report.startup = startup

    if (mode === 'write') {
      report.loadedScores = await window.webContents.executeJavaScript(`(async () => {
        await window.electris.highScores.save(${JSON.stringify(expectedScores)})
        await window.electris.openExternal('author')
        await window.electris.openExternal('license')
        await window.electris.window.minimize()
        return window.electris.highScores.load()
      })()`)
      window.restore()
    } else {
      report.loadedScores = await window.webContents.executeJavaScript(
          'window.electris.highScores.load()')
    }

    writeReport()
    window.once('closed', () => {
      report.closed = true
      writeReport()
    })
    await window.webContents.executeJavaScript(
        'window.electris.window.close().catch(() => undefined); "close requested"')
        .catch((error) => {
          if (!window.isDestroyed()) throw error
        })
    await waitFor(() => window.isDestroyed())
  } catch (error) {
    fail(error)
  }
}

async function waitFor(readValue, timeout = 10000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await readValue()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw lastError || new Error('Timed out waiting for the actual Electron renderer')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
