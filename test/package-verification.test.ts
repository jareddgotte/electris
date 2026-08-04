import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
}
const { appFiles, artifactName, packageRecordName } = require(
    '../scripts/package-config.cjs') as {
      appFiles: ReadonlyArray<{source: string, packaged: string}>
      artifactName: (platform: string, arch: string) => string
      packageRecordName: string
    }
const { createPackage, readTarget } = require('../scripts/package.cjs') as {
  createPackage: (
    target: {platform: string, arch: string},
    operations?: {distPath: string, runCleanBuild: () => void}
  ) => Promise<string>
  readTarget: (args: string[]) => {platform: string, arch: string} | null
}
const { binaryIdentity, expectedPackagedPackage, verifyArtifact } = require(
    '../scripts/package-verify.cjs') as {
      binaryIdentity: (executablePath: string) => {platform: string, arch?: string}
      expectedPackagedPackage: (sourcePackage?: ProjectPackage) => Record<string, unknown>
      verifyArtifact: (
        artifact: string,
        options?: {sourceRoot: string, sourcePackage: ProjectPackage}
      ) => unknown
    }

interface ProjectPackage {
  name: string
  version: string
  description: string
  main: string
  author: string
  license: string
  devDependencies: {electron: string}
}

const sourcePackage: ProjectPackage = {
  name: 'electris',
  version: '0.1.2',
  description: 'js-tetris on Electron',
  main: 'app/main.js',
  author: 'Jared Gotte',
  license: 'ISC',
  devDependencies: {electron: '43.2.0'}
}

function writeFile(filePath: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

function writeLinuxExecutable(filePath: string, machine = 62) {
  const header = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header)
  header.writeUInt16LE(machine, 18)
  writeFile(filePath, header)
  fs.chmodSync(filePath, 0o755)
}

function writePeExecutable(filePath: string, machine: number) {
  const peOffset = 0x40
  const header = Buffer.alloc(peOffset + 6)
  header.write('MZ', 0, 'ascii')
  header.writeUInt32LE(peOffset, 0x3c)
  header.write('PE\0\0', peOffset, 'ascii')
  header.writeUInt16LE(machine, peOffset + 4)
  writeFile(filePath, header)
  fs.chmodSync(filePath, 0o755)
}

function writeMachOExecutable(filePath: string, cpuType: number) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(0xcffaedfe, 0)
  header.writeUInt32LE(cpuType, 4)
  writeFile(filePath, header)
  fs.chmodSync(filePath, 0o755)
}

describe('package verification', () => {
  let temporaryRoot: string
  let artifactPath: string
  let stagePath: string
  let asarPath: string
  let recordPath: string

  beforeEach(async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-package-verify-'))
    artifactPath = path.join(
        temporaryRoot, 'dist', artifactName('linux', 'x64'))
    stagePath = path.join(temporaryRoot, 'stage')
    asarPath = path.join(artifactPath, 'resources', 'app.asar')
    recordPath = path.join(artifactPath, packageRecordName)

    for (const {source, packaged} of appFiles) {
      const content = `reviewed content for ${packaged}\n`
      writeFile(path.join(temporaryRoot, source), content)
      writeFile(path.join(stagePath, packaged), content)
    }
    writeFile(
        path.join(stagePath, 'package.json'),
        JSON.stringify(expectedPackagedPackage(sourcePackage)))
    fs.mkdirSync(path.dirname(asarPath), {recursive: true})
    await asar.createPackage(stagePath, asarPath)
    writeLinuxExecutable(path.join(artifactPath, 'electris'))
    writeFile(path.join(artifactPath, 'version'), `${sourcePackage.devDependencies.electron}\n`)
    writeFile(recordPath, JSON.stringify({
      schemaVersion: 1,
      name: sourcePackage.name,
      version: sourcePackage.version,
      electronVersion: sourcePackage.devDependencies.electron,
      platform: 'linux',
      arch: 'x64',
      outputPath: `dist/${artifactName('linux', 'x64')}`,
      launchedOnTargetOs: false
    }))
  })

  afterEach(() => {
    fs.rmSync(temporaryRoot, {recursive: true, force: true})
  })

  it('accepts exact identity, target, binary, and allowlisted application contents', () => {
    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .not.toThrow()
  })

  it('fails closed when a required file is missing', async () => {
    fs.rmSync(path.join(stagePath, 'preload.js'))
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/missing=\[preload\.js\]/)
  })

  it('fails closed when the packaged app.asar contains unlisted content', async () => {
    writeFile(path.join(stagePath, 'src', '.env'), 'SECRET=not-allowed')
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/forbidden=\[src, src\/\.env\]/)
  })

  it('fails closed when source, test, development, cache, or secret content appears outside app.asar', () => {
    writeFile(path.join(artifactPath, '.env'), 'SECRET=not-allowed')

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/forbidden source, test, development, cache, or secret-like path is present: \.env/)
  })

  it('rejects identity and version mismatches', () => {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    record.version = '9.9.9'
    fs.writeFileSync(recordPath, JSON.stringify(record))

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/identity, version, or Electron version/)
  })

  it('rejects an Electron runtime version mismatch', () => {
    fs.writeFileSync(path.join(artifactPath, 'version'), '42.0.0\n')

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/runtime version/)
  })

  it('rejects an executable architecture mismatch', () => {
    writeLinuxExecutable(path.join(artifactPath, 'electris'), 183)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/executable is linux\/arm64, record says linux\/x64/)
  })

  it('identifies a Windows PE x64 executable', () => {
    const filePath = path.join(temporaryRoot, 'electris.exe')
    writePeExecutable(filePath, 0x8664)

    expect(binaryIdentity(filePath)).toEqual({platform: 'win32', arch: 'x64'})
  })

  it('identifies a macOS Mach-O arm64 executable', () => {
    const filePath = path.join(temporaryRoot, 'electris-macho')
    writeMachOExecutable(filePath, 0x0100000c)

    expect(binaryIdentity(filePath)).toEqual({platform: 'darwin', arch: 'arm64'})
  })

  it('requires both explicit target arguments outside host mode', () => {
    expect(readTarget(['--platform=linux'])).toBeNull()
    expect(readTarget(['--arch=x64'])).toBeNull()
    expect(readTarget(['--platform=linux', '--arch=x64']))
      .toEqual({platform: 'linux', arch: 'x64'})
  })

  it('removes stale and partial target output when the clean build fails', async () => {
    const distPath = path.join(temporaryRoot, 'failed-dist')
    const staleOutput = path.join(distPath, artifactName('linux', 'x64'))
    writeFile(path.join(staleOutput, 'stale-partial-file'), 'not a completed artifact')

    await expect(createPackage(
        {platform: 'linux', arch: 'x64'},
        {
          distPath,
          runCleanBuild: () => { throw new Error('deliberate build failure') }
        }))
      .rejects.toThrow(/deliberate build failure/)
    expect(fs.existsSync(staleOutput)).toBe(false)
    expect(fs.readdirSync(distPath)).toEqual([])
  })
})
