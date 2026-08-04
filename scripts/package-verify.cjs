'use strict'

const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')
const {
  appFiles,
  artifactName,
  packageRecordName,
  projectPackage,
  root,
  runtimeLayout,
  targets
} = require('./package-config.cjs')

function fail(message) {
  throw new Error(`Package verification failed: ${message}`)
}

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`could not read ${description} at ${filePath}: ${error.message}`)
  }
}

function normalizeAsarPath(filePath) {
  return filePath.replace(/^[/\\]/, '').replaceAll('\\', '/')
}

function binaryIdentity(executablePath) {
  const bytes = fs.readFileSync(executablePath).subarray(0, 4096)

  if (bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const littleEndian = bytes[5] === 1
    const machine = littleEndian ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    const arch = new Map([[3, 'ia32'], [40, 'armv7l'], [62, 'x64'], [183, 'arm64']]).get(machine)
    return {platform: 'linux', arch}
  }

  if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const peOffset = bytes.readUInt32LE(0x3c)
    if (peOffset + 6 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
      fail('Windows executable has an invalid PE header')
    }
    const machine = bytes.readUInt16LE(peOffset + 4)
    const arch = new Map([[0x14c, 'ia32'], [0x8664, 'x64'], [0xaa64, 'arm64']]).get(machine)
    return {platform: 'win32', arch}
  }

  if (bytes.length >= 8) {
    const magic = bytes.readUInt32BE(0)
    let cpuType
    if (magic === 0xfeedfacf) cpuType = bytes.readUInt32BE(4)
    if (magic === 0xcffaedfe) cpuType = bytes.readUInt32LE(4)
    if (cpuType !== undefined) {
      const arch = new Map([[0x01000007, 'x64'], [0x0100000c, 'arm64']]).get(cpuType)
      return {platform: 'darwin', arch}
    }
  }

  fail(`could not identify the executable format and architecture: ${executablePath}`)
}

function assertNoForbiddenPaths(artifactPath) {
  const forbiddenSegments = new Set([
    '.cache', '.git', '.github', '.idea', '.npm', '.vscode',
    'coverage', 'node_modules', 'scripts', 'src', 'static', 'test', 'tests'
  ])
  const forbiddenFile = /(^|\/)(\.env($|\.)|[^/]+\.(?:d\.ts|map|key|pem|p12|pfx)|npm-debug\.log$)/i
  const pending = [artifactPath]

  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(artifactPath, absolute).split(path.sep).join('/')
      const segments = relative.split('/')
      if (segments.some((segment) => forbiddenSegments.has(segment)) || forbiddenFile.test(relative)) {
        fail(`forbidden source, test, development, cache, or secret-like path is present: ${relative}`)
      }
      // Electron's macOS framework contains required relative symlinks. They must
      // remain inside the package so archival/extraction cannot capture or redirect
      // through host paths. The staged app itself is sealed in app.asar and checked
      // against the exact allowlist above.
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute)
        const resolved = path.resolve(path.dirname(absolute), target)
        const relativeTarget = path.relative(artifactPath, resolved)
        if (path.isAbsolute(target) || relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`)) {
          fail(`symbolic link escapes the artifact: ${relative} -> ${target}`)
        }
      }
      if (entry.isDirectory()) pending.push(absolute)
    }
  }
}

function expectedPackagedPackage(sourcePackage = projectPackage) {
  return {
    name: sourcePackage.name,
    version: sourcePackage.version,
    description: sourcePackage.description,
    main: sourcePackage.main.replace(/^app\//, ''),
    author: sourcePackage.author,
    license: sourcePackage.license
  }
}

function verifyArtifact(artifactArgument, options = {}) {
  const sourceRoot = options.sourceRoot || root
  const sourcePackage = options.sourcePackage || projectPackage
  const artifactPath = path.resolve(sourceRoot, artifactArgument)
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isDirectory()) {
    fail(`artifact directory does not exist: ${artifactPath}`)
  }

  const recordPath = path.join(artifactPath, packageRecordName)
  const record = readJson(recordPath, 'package record')
  if (record.schemaVersion !== 1 || record.name !== sourcePackage.name ||
      record.version !== sourcePackage.version || record.electronVersion !== sourcePackage.devDependencies.electron) {
    fail('package record identity, version, or Electron version does not match package.json')
  }
  if (!Object.hasOwn(targets, record.platform) || !targets[record.platform].includes(record.arch)) {
    fail(`package record has an unreviewed target: ${record.platform}/${record.arch}`)
  }

  const expectedName = artifactName(record.platform, record.arch)
  if (path.basename(artifactPath) !== expectedName || record.outputPath !== `dist/${expectedName}`) {
    fail(`output name/path does not encode exact version and target (${expectedName})`)
  }
  if (typeof record.launchedOnTargetOs !== 'boolean') fail('launch status is not recorded')
  const runtimeVersionPath = path.join(artifactPath, 'version')
  if (!fs.existsSync(runtimeVersionPath) ||
      fs.readFileSync(runtimeVersionPath, 'utf8').trim() !== record.electronVersion) {
    fail('packaged Electron runtime version does not match the package record')
  }
  if (record.launchedOnTargetOs &&
      (record.launchPlatform !== record.platform || record.launchArch !== record.arch ||
       record.smokeEvidence !== 'startup, isolated preload/CSP/navigation, window controls, and score restart passed')) {
    fail('recorded smoke evidence does not match the target')
  }

  const layout = runtimeLayout(artifactPath, record.platform)
  for (const [kind, filePath] of Object.entries(layout)) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`required ${kind} is missing: ${filePath}`)
  }
  const actualBinary = binaryIdentity(layout.executable)
  if (actualBinary.platform !== record.platform || actualBinary.arch !== record.arch) {
    fail(`executable is ${actualBinary.platform}/${actualBinary.arch || 'unknown'}, record says ${record.platform}/${record.arch}`)
  }

  if (fs.existsSync(`${layout.asar}.unpacked`)) fail('unexpected app.asar.unpacked content is present')
  const actualFiles = asar.listPackage(layout.asar).map(normalizeAsarPath).sort()
  const expectedPayloadFiles = [...appFiles.map(({packaged}) => packaged), 'package.json']
  const expectedDirectories = [...new Set(expectedPayloadFiles.flatMap((file) => {
    const directories = []
    let directory = path.posix.dirname(file)
    while (directory !== '.') {
      directories.push(directory)
      directory = path.posix.dirname(directory)
    }
    return directories
  }))]
  const expectedFiles = [...expectedPayloadFiles, ...expectedDirectories].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    const missing = expectedFiles.filter((file) => !actualFiles.includes(file))
    const forbidden = actualFiles.filter((file) => !expectedFiles.includes(file))
    fail(`application allowlist mismatch; missing=[${missing.join(', ')}], forbidden=[${forbidden.join(', ')}]`)
  }

  const packagedPackage = JSON.parse(asar.extractFile(layout.asar, 'package.json').toString())
  if (JSON.stringify(packagedPackage) !== JSON.stringify(expectedPackagedPackage(sourcePackage))) {
    fail('packaged package.json identity or runtime dependency policy does not match')
  }

  for (const {source, packaged, verifySource} of appFiles) {
    const actual = asar.extractFile(layout.asar, packaged)
    if (actual.length === 0) fail(`required application content is empty: ${packaged}`)
    // Generated bundles need not exist in a fresh checkout that is only inspecting a
    // copied artifact. Tracked assets and the project license must still match exactly.
    if (verifySource) {
      const expected = fs.readFileSync(path.join(sourceRoot, source))
      if (!actual.equals(expected)) fail(`packaged content differs from the reviewed source: ${packaged}`)
    }
  }

  assertNoForbiddenPaths(artifactPath)
  return {artifactPath, record}
}

function main() {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run package:verify -- <artifact-path>')
    process.exitCode = 2
    return
  }

  try {
    const {artifactPath, record} = verifyArtifact(process.argv[2])
    console.log(`Verified Electris ${record.version} / Electron ${record.electronVersion} / ${record.platform}/${record.arch}`)
    console.log(`Output: ${artifactPath}`)
    console.log(`Launched on target OS: ${record.launchedOnTargetOs ? 'yes' : 'no'}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {binaryIdentity, expectedPackagedPackage, verifyArtifact}
