'use strict'

const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const {spawn, spawnSync} = require('child_process')
const {
  packageRecordName,
  runtimeLayout
} = require('./package-config.cjs')
const {verifyArtifact} = require('./package-verify.cjs')

const expectedScores = [55, 34, 21, 13, 8, 5, 3, 2, 1, 0]
const launchTimeout = 45000

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const {port} = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

class DevToolsClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true})
      this.socket.addEventListener('error', () => reject(new Error('DevTools WebSocket connection failed')), {once: true})
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id || !this.pending.has(message.id)) return
      const {resolve, reject, timer} = this.pending.get(message.id)
      clearTimeout(timer)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`DevTools command timed out: ${method}`))
      }, 10000)
      this.pending.set(id, {resolve, reject, timer})
      this.socket.send(JSON.stringify({id, method, params}))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.text}`)
    return result.result.value
  }

  close() {
    for (const {reject, timer} of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('DevTools connection closed'))
    }
    this.pending.clear()
    this.socket.close()
  }
}

async function waitFor(readValue, timeout = 10000, signal) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('Operation aborted')
    try {
      const value = await readValue()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw lastError || new Error('Timed out waiting for packaged Electron')
}

async function findRenderer(port, signal) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(1000)])
        : AbortSignal.timeout(1000)
    })
    if (!response.ok) return null
    const targets = await response.json()
    return targets.find((target) => target.type === 'page' && target.url.startsWith('file:')) || null
  }, 15000, signal)
}

function launchCommand(executable, args) {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], {encoding: 'utf8'})
    if (xvfb.status !== 0) {
      throw new Error('Package smoke requires a display; DISPLAY is unset and xvfb-run is unavailable')
    }
    return {command: 'xvfb-run', args: ['-a', executable, ...args]}
  }
  return {command: executable, args}
}

function stopProcess(child, signal = 'SIGTERM') {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function waitForExit(child, timeout = 5000) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeout)
  ])
}

async function smokeLaunch(executable, userDataPath, mode, operations = {}) {
  const reserveDebugPort = operations.reservePort || reservePort
  const chooseLaunchCommand = operations.launchCommand || launchCommand
  const spawnProcess = operations.spawnProcess || spawn
  const stopChild = operations.stopProcess || stopProcess
  const waitForChildExit = operations.waitForExit || waitForExit
  const port = await reserveDebugPort()
  const launch = chooseLaunchCommand(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataPath}`,
    '--disable-gpu'
  ])
  const child = spawnProcess(launch.command, launch.args, {
    detached: process.platform !== 'win32',
    env: {...process.env, NODE_ENV: 'production'},
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  const appendOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-100000)
  }
  const rendererDiscovery = new AbortController()
  const spawnFailure = new Promise((_resolve, reject) => {
    child.once('error', (error) => {
      const detail = error instanceof Error ? error.stack || error.message : String(error)
      appendOutput(`[spawn error] ${detail}\n`)
      const launchError = new Error(`Could not launch packaged Electron: ${detail}`)
      rendererDiscovery.abort(launchError)
      reject(launchError)
    })
  })
  child.stdout.on('data', appendOutput)
  child.stderr.on('data', appendOutput)
  let client
  const watchdog = setTimeout(() => stopChild(child, 'SIGTERM'), launchTimeout)

  try {
    const target = await Promise.race([
      findRenderer(port, rendererDiscovery.signal),
      spawnFailure
    ])
    client = new DevToolsClient(target.webSocketDebuggerUrl)
    await client.connect()
    await client.send('Runtime.enable')

    const startup = await waitFor(async () => {
      const value = await client.evaluate(`({
        listLength: document.querySelectorAll('#high-scores-list li').length,
        firstScore: document.querySelector('#high-scores-list li')?.textContent || '',
        canvasWidth: document.querySelector('#canvas')?.width || 0,
        canvasHeight: document.querySelector('#canvas')?.height || 0,
        requireType: typeof require,
        processType: typeof process,
        bridgeKeys: Object.keys(window.electris || {}).sort(),
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''
      })`)
      return value.listLength === 10 ? value : null
    })
    assert(startup.canvasWidth === 200 && startup.canvasHeight === 400,
        'packaged renderer did not initialize its canvas')
    assert(startup.requireType === 'undefined' && startup.processType === 'undefined',
        'Node globals leaked into the packaged renderer')
    assert(JSON.stringify(startup.bridgeKeys) === JSON.stringify(['highScores', 'openExternal', 'window']),
        'packaged preload exposed an unexpected bridge surface')
    assert(startup.csp.includes("default-src 'none'") && startup.csp.includes("connect-src 'none'"),
        'packaged renderer did not load the production CSP')

    const security = await client.evaluate(`(async () => {
      window.__electrisInlineScriptRan = false
      const script = document.createElement('script')
      script.textContent = 'window.__electrisInlineScriptRan = true'
      document.body.appendChild(script)
      const popup = window.open('https://example.com/electris-smoke-popup')
      location.href = 'https://example.com/electris-smoke-navigation'
      await new Promise(resolve => setTimeout(resolve, 200))
      return {
        inlineScriptRan: window.__electrisInlineScriptRan,
        popupOpened: popup !== null,
        location: location.href
      }
    })()`)
    assert(security.inlineScriptRan === false, 'packaged CSP allowed an injected inline script')
    assert(security.popupOpened === false, 'packaged navigation policy allowed a popup')
    assert(security.location.startsWith('file:'), 'packaged navigation policy allowed remote navigation')

    let loadedScores
    if (mode === 'write') {
      loadedScores = await client.evaluate(`(async () => {
        await window.electris.highScores.save(${JSON.stringify(expectedScores)})
        await window.electris.window.minimize()
        return window.electris.highScores.load()
      })()`)
    } else {
      loadedScores = await client.evaluate('window.electris.highScores.load()')
    }
    assert(JSON.stringify(loadedScores) === JSON.stringify(expectedScores),
        `packaged score ${mode === 'write' ? 'save/load' : 'restart load'} did not round-trip`)
    if (mode === 'read') {
      assert(startup.firstScore === String(expectedScores[0]),
          'packaged renderer did not render the persisted score after restart')
    }

    await client.evaluate('window.electris.window.close()').catch(() => undefined)
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(500)
        })
        const targets = await response.json()
        return !targets.some((entry) => entry.type === 'page' && entry.url.startsWith('file:'))
      } catch {
        return true
      }
    })
    return startup
  } catch (error) {
    throw new Error(`${error.message}\nPackaged Electron output:\n${output}`)
  } finally {
    rendererDiscovery.abort()
    clearTimeout(watchdog)
    if (client) client.close()
    stopChild(child, 'SIGTERM')
    await waitForChildExit(child)
    stopChild(child, 'SIGKILL')
  }
}

async function runSmoke(artifactArgument) {
  const {artifactPath, record} = verifyArtifact(artifactArgument)
  assert(record.platform === process.platform && record.arch === process.arch,
      `artifact is ${record.platform}/${record.arch}; this host is ${process.platform}/${process.arch}`)
  const executable = runtimeLayout(artifactPath, record.platform).executable
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-package-smoke-'))

  try {
    await smokeLaunch(executable, path.join(temporaryRoot, 'user-data'), 'write')
    await smokeLaunch(executable, path.join(temporaryRoot, 'user-data'), 'read')

    const recordPath = path.join(artifactPath, packageRecordName)
    const updatedRecord = {
      ...record,
      launchedOnTargetOs: true,
      launchPlatform: process.platform,
      launchArch: process.arch,
      smokeEvidence: 'startup, isolated preload/CSP/navigation, window controls, and score restart passed'
    }
    fs.writeFileSync(recordPath, `${JSON.stringify(updatedRecord, null, 2)}\n`)
    verifyArtifact(artifactPath)
    console.log(`Packaged artifact smoke passed: ${artifactPath}`)
    console.log(`Launched on target OS: yes (${process.platform}/${process.arch})`)
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true})
  }
}

async function main() {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run package:smoke -- <artifact-path>')
    process.exitCode = 2
    return
  }
  try {
    await runSmoke(process.argv[2])
  } catch (error) {
    console.error(`Package smoke failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()

module.exports = {runSmoke, smokeLaunch}
