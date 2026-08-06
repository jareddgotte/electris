import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
}
const { appFiles, artifactName, packageRecordName } = require(
    '../scripts/package-config.cjs') as {
      appFiles: ReadonlyArray<
        {source: string, packaged: string, verifySource?: boolean, newlineInsensitive?: boolean}>
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
const { binaryIdentity, expectedPackagedPackage, matchesReviewedSource, verifyArtifact } = require(
    '../scripts/package-verify.cjs') as {
      binaryIdentity: (executablePath: string) => {platform: string, arch?: string}
      expectedPackagedPackage: (sourcePackage?: ProjectPackage) => Record<string, unknown>
      matchesReviewedSource: (
        actual: Buffer, expected: Buffer, newlineInsensitive?: boolean) => boolean
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Verbatim bytes from the published v0.2.0-rc.3 Windows archive's app.asar, whose
// provenance and digests are recorded in test/fixtures/published/README.md. They are the
// real artifact that failed `npm run package:verify` on an LF checkout, so the regression
// is characterized with the bytes that exposed it rather than a synthetic reproduction.
const publishedWindowsAssets = [
  {
    source: 'app/css/main.css',
    packaged: 'css/main.css',
    fixture: 'v0.2.0-rc.3-win32-x64-css-main.css',
    digest: 'c9e3fe3c619ed99149974db8af1c983c31a1d2e8bb7e4b01836530416b78f1c4',
    carriageReturns: 129
  },
  {
    source: 'LICENSE',
    packaged: 'LICENSE',
    fixture: 'v0.2.0-rc.3-win32-x64-LICENSE',
    digest: 'd15edc5cb3d9a163d6ebdbaa217de6d17b73353e350566eb4e15a5c0d3535703',
    carriageReturns: 4
  }
] as const

function readPublishedFixture(name: string) {
  return fs.readFileSync(path.join(repoRoot, 'test', 'fixtures', 'published', name))
}

function crlfToLf(buffer: Buffer) {
  return Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
}

// Flips one byte that is neither CR nor LF, so the result has the same length and the
// same line endings as its input and differs only in content.
function changeOneContentByte(buffer: Buffer) {
  const changed = Buffer.from(buffer)
  const index = changed.findIndex((byte) => byte !== 0x0d && byte !== 0x0a)
  changed[index] ^= 0x01
  return changed
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

  it('verifies the published rc.3 Windows text assets against an LF checkout', async () => {
    for (const {source, packaged, fixture} of publishedWindowsAssets) {
      writeFile(path.join(temporaryRoot, source), fs.readFileSync(path.join(repoRoot, source)))
      writeFile(path.join(stagePath, packaged), readPublishedFixture(fixture))
    }
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .not.toThrow()
  })

  it('verifies an LF-packaged tracked text asset against a CRLF checkout', async () => {
    for (const {source, packaged, fixture} of publishedWindowsAssets) {
      writeFile(path.join(temporaryRoot, source), readPublishedFixture(fixture))
      writeFile(path.join(stagePath, packaged), fs.readFileSync(path.join(repoRoot, source)))
    }
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .not.toThrow()
  })

  it('still fails closed when a tracked text asset differs by content, not only line endings', async () => {
    for (const {source, packaged, fixture} of publishedWindowsAssets) {
      writeFile(path.join(temporaryRoot, source), fs.readFileSync(path.join(repoRoot, source)))
      writeFile(path.join(stagePath, packaged), changeOneContentByte(readPublishedFixture(fixture)))
    }
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/packaged content differs from the reviewed source: css\/main\.css/)
  })

  it('never newline-normalizes a verified binary asset', async () => {
    const png = fs.readFileSync(path.join(repoRoot, 'app/img/TETRIS.png'))
    const normalized = crlfToLf(png)
    // The tracked PNG genuinely contains CRLF byte pairs, so normalizing it would
    // silently corrupt real image data rather than harmonize a checkout difference.
    expect(normalized.equals(png)).toBe(false)
    writeFile(path.join(temporaryRoot, 'app/img/TETRIS.png'), png)
    writeFile(path.join(stagePath, 'img/TETRIS.png'), normalized)
    await asar.createPackage(stagePath, asarPath)

    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/packaged content differs from the reviewed source: img\/TETRIS\.png/)
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

  it('allows internal runtime symlinks and rejects links that escape the artifact', () => {
    fs.symlinkSync('version', path.join(artifactPath, 'internal-version-link'))
    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .not.toThrow()

    fs.symlinkSync(path.join(temporaryRoot, 'outside-secret'), path.join(artifactPath, 'escaping-link'))
    expect(() => verifyArtifact(artifactPath, {sourceRoot: temporaryRoot, sourcePackage}))
      .toThrow(/symbolic link escapes the artifact/)
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

describe('published rc.3 Windows fixtures', () => {
  it.each(publishedWindowsAssets)(
      'keeps $fixture byte-identical to the published archive entry',
      ({fixture, digest}) => {
        const bytes = readPublishedFixture(fixture)

        expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(digest)
      })

  it.each(publishedWindowsAssets)(
      'differs from $source by CRLF alone, by exactly $carriageReturns pairs',
      ({source, fixture, carriageReturns}) => {
        const published = readPublishedFixture(fixture)
        const checkedIn = fs.readFileSync(path.join(repoRoot, source))

        expect(published.equals(checkedIn)).toBe(false)
        expect(published.length - checkedIn.length).toBe(carriageReturns)
        expect(published.toString('latin1').match(/\r\n/g)?.length).toBe(carriageReturns)
        expect(crlfToLf(published).equals(checkedIn)).toBe(true)
      })

  it('checks tracked text assets out with LF endings', () => {
    for (const {source} of publishedWindowsAssets) {
      expect(fs.readFileSync(path.join(repoRoot, source)).includes('\r')).toBe(false)
    }
  })
})

describe('reviewed source comparison', () => {
  const lf = Buffer.from('a\nb\n')
  const crlf = Buffer.from('a\r\nb\r\n')

  it('accepts identical bytes whether or not the asset is newline-insensitive', () => {
    expect(matchesReviewedSource(lf, Buffer.from(lf), true)).toBe(true)
    expect(matchesReviewedSource(lf, Buffer.from(lf), undefined)).toBe(true)
  })

  it('tolerates CRLF against LF only for a declared newline-insensitive asset', () => {
    expect(matchesReviewedSource(crlf, lf, true)).toBe(true)
    expect(matchesReviewedSource(lf, crlf, true)).toBe(true)
    expect(matchesReviewedSource(crlf, lf, undefined)).toBe(false)
  })

  it('rejects any difference that is not a CRLF pair', () => {
    expect(matchesReviewedSource(Buffer.from('a\nc\n'), lf, true)).toBe(false)
    expect(matchesReviewedSource(Buffer.from('a\n b\n'), lf, true)).toBe(false)
    // A lone CR is real content, not a checkout artifact, so it is never rewritten.
    expect(matchesReviewedSource(Buffer.from('a\rb\n'), lf, true)).toBe(false)
  })

  it('compares content holding a NUL byte strictly even when declared newline-insensitive', () => {
    const binaryish = Buffer.from([0x61, 0x00, 0x0d, 0x0a])
    const normalized = Buffer.from([0x61, 0x00, 0x0a])

    expect(matchesReviewedSource(binaryish, normalized, true)).toBe(false)
  })

  it('declares newline insensitivity only for tracked text assets', () => {
    const insensitive = appFiles.filter(({newlineInsensitive}) => newlineInsensitive)
      .map(({packaged}) => packaged)

    expect(insensitive).toEqual(['css/main.css', 'LICENSE'])
    expect(appFiles.every(({verifySource, newlineInsensitive}) => verifySource || !newlineInsensitive))
      .toBe(true)
  })
})
