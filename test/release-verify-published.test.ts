import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  assertExactAssetSet,
  assertPublishedIdentity,
  downloadPublishedRelease,
  expectedAssetNames,
  extractPublicArchive,
  parseOptions,
  publicDownloadUrl,
  writeVerificationRecord
} = require('../scripts/release-verify-published.cjs') as {
  assertExactAssetSet: (assets: ApiAsset[], version: string) => string[]
  assertPublishedIdentity: (release: ApiRelease | null, identity: SelectedIdentity) => void
  downloadPublishedRelease: (
    options: Record<string, string>,
    operations: {client: FakeClient, fetch: FakeFetch}
  ) => Promise<{record: IdentityRecord, output: string, recordPath: string}>
  expectedAssetNames: (version: string) => string[]
  extractPublicArchive: (options: Record<string, string>) => string
  parseOptions: (args: string[]) => Record<string, string> | null
  publicDownloadUrl: (repository: string, tag: string, name: string) => string
  writeVerificationRecord: (
    options: Record<string, string>,
    operations: {verifyArtifact: () => {record: PackageRecord}}
  ) => string
}
const {
  assembleReleaseAssets
} = require('../scripts/release-assets.cjs') as {
  assembleReleaseAssets: (options: Record<string, string>) => unknown
}
const {
  releaseArchiveName,
  releaseTargets,
  targetKey
} = require('../scripts/release-config.cjs') as {
  releaseArchiveName: (version: string, target: ReleaseTarget) => string
  releaseTargets: ReleaseTarget[]
  targetKey: (platform: string, arch: string) => string
}

interface ReleaseTarget {platform: string, arch: string, extension: string, portable: boolean, public: boolean}
interface ApiAsset {
  id?: number
  name: string
  size: number
  state?: string
  digest?: string
  browser_download_url?: string
}
interface ApiRelease {
  id: number
  tag_name: string
  name: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  target_commitish?: string
  html_url?: string
  assets: ApiAsset[]
}
interface SelectedIdentity {tag: string, version?: string, releaseId: number, prerelease: boolean}
interface IdentityRecord {
  tag: string
  releaseId: number
  repository: string
  release: {publishedAt: string}
  assets: Array<{id: number, name: string, size: number, sha256: string}>
}
interface PackageRecord {
  name: string
  version: string
  electronVersion: string
  platform: string
  arch: string
  launchedOnTargetOs: boolean
  launchPlatform?: string
  launchArch?: string
  smokeEvidence?: string
}
type FakeFetch = (url: string) => Promise<{ok: boolean, status: number, arrayBuffer: () => Promise<ArrayBuffer>}>

const tag = 'v9.9.9-rc.1'
const version = '9.9.9-rc.1'
const commit = 'b'.repeat(40)
const repository = 'jareddgotte/electris'
const smokeEvidence = 'startup, isolated preload/CSP/navigation, window controls, and score restart passed'
const linuxTarget = releaseTargets.find((target) => target.platform === 'linux' && target.arch === 'x64') as ReleaseTarget
const linuxArchiveName = releaseArchiveName(version, linuxTarget)
const packageDirectoryName = `electris-v${version}-linux-x64`

function hash(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeFile(filePath: string, content: Buffer | string) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

// Stage a release whose Linux archive is a genuine tar.gz of a one-directory package, so
// extraction exercises the real archive tooling instead of a listing stub.
function createPublicRelease(temporaryRoot: string) {
  const staging = path.join(temporaryRoot, 'staging')
  const packageRoot = path.join(temporaryRoot, 'package-source')
  writeFile(path.join(packageRoot, packageDirectoryName, 'electris'), '#!/bin/sh\n')
  for (const target of releaseTargets) {
    const key = targetKey(target.platform, target.arch)
    const directory = path.join(staging, key)
    const basename = releaseArchiveName(version, target)
    fs.mkdirSync(directory, {recursive: true})
    if (key === 'linux-x64') {
      expect(spawnSync('tar', ['-czf', path.join(directory, basename), '-C', packageRoot, packageDirectoryName]).status).toBe(0)
    } else {
      writeFile(path.join(directory, basename), Buffer.from(`archive bytes for ${key}`))
    }
    const bytes = fs.readFileSync(path.join(directory, basename))
    writeFile(path.join(directory, `release-fragment-${key}.json`), `${JSON.stringify({
      schemaVersion: 1,
      tag,
      commit,
      packageVersion: version,
      electronVersion: '43.2.0',
      workflow: {runId: '31067550562', runUrl: 'https://github.example/runs/31067550562'},
      target: {platform: target.platform, arch: target.arch, key, public: target.public},
      archive: {basename, bytes: bytes.length, sha256: hash(bytes)},
      smoke: {passed: true, evidence: smokeEvidence},
      signing: {
        state: 'unsigned',
        notarization: target.platform === 'darwin' ? 'not-notarized' : 'not-applicable'
      },
      archiveTool: {command: 'tar', version: 'test tar 1.0'}
    }, null, 2)}\n`)
  }
  const output = path.join(temporaryRoot, 'public')
  assembleReleaseAssets({input: staging, output, tag, commit})
  return output
}

function publishedRelease(assetsDirectory: string, overrides: Partial<ApiRelease> = {}): ApiRelease {
  const assets = fs.readdirSync(assetsDirectory).sort().map((name, index) => {
    const bytes = fs.readFileSync(path.join(assetsDirectory, name))
    return {
      id: 500000000 + index,
      name,
      size: bytes.length,
      state: 'uploaded',
      digest: `sha256:${hash(bytes)}`,
      browser_download_url: publicDownloadUrl(repository, tag, name)
    }
  })
  return {
    id: 365952827,
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: true,
    published_at: '2026-08-06T06:08:29Z',
    target_commitish: commit,
    html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    assets,
    ...overrides
  }
}

class FakeClient {
  constructor(public releases: ApiRelease[]) {}

  async request(method: string, url: string) {
    if (method === 'GET' && url.includes('/releases?')) {
      const parsed = new URL(url, 'https://api.github.example')
      const page = Number(parsed.searchParams.get('page'))
      const perPage = Number(parsed.searchParams.get('per_page'))
      return this.releases.slice((page - 1) * perPage, page * perPage)
    }
    throw new Error(`Unexpected fake request: ${method} ${url}`)
  }
}

function fakeFetch(assetsDirectory: string, mutate?: (name: string, bytes: Buffer) => Buffer | number) {
  return (async (url: string) => {
    const name = url.slice(url.lastIndexOf('/') + 1)
    const original = fs.readFileSync(path.join(assetsDirectory, name))
    const replaced = mutate?.(name, original)
    if (typeof replaced === 'number') return {ok: false, status: replaced, arrayBuffer: async () => new ArrayBuffer(0)}
    const bytes = replaced || original
    return {ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}
  }) as FakeFetch
}

function packageRecord(values: Partial<PackageRecord> = {}): PackageRecord {
  return {
    name: 'electris',
    version,
    electronVersion: '43.2.0',
    platform: 'linux',
    arch: 'x64',
    launchedOnTargetOs: true,
    launchPlatform: 'linux',
    launchArch: 'x64',
    smokeEvidence,
    ...values
  }
}

describe('published release selection and public asset set', () => {
  const identity: SelectedIdentity = {tag, releaseId: 365952827, prerelease: true}

  it('accepts only the exact published release named by both tag and release ID', () => {
    expect(() => assertPublishedIdentity(publishedRelease0(), identity)).not.toThrow()
    expect(() => assertPublishedIdentity(null, identity)).toThrow(/no GitHub Release exists/)
    expect(() => assertPublishedIdentity(publishedRelease0({id: 365762809}), identity))
      .toThrow(/not the selected 365952827/)
    expect(() => assertPublishedIdentity(publishedRelease0({draft: true}), identity))
      .toThrow(/still a draft/)
    expect(() => assertPublishedIdentity(publishedRelease0({published_at: null}), identity))
      .toThrow(/no publication timestamp/)
    expect(() => assertPublishedIdentity(publishedRelease0({prerelease: false}), identity))
      .toThrow(/channel is prerelease=false/)
    expect(() => assertPublishedIdentity(publishedRelease0({name: 'Release candidate 3'}), identity))
      .toThrow(/does not identify tag/)
  })

  function publishedRelease0(overrides: Partial<ApiRelease> = {}): ApiRelease {
    return {
      id: 365952827,
      tag_name: tag,
      name: tag,
      draft: false,
      prerelease: true,
      published_at: '2026-08-06T06:08:29Z',
      assets: [],
      ...overrides
    }
  }

  it('requires exactly the four public asset names with no extra and no macOS ZIP', () => {
    const names = expectedAssetNames(version)
    expect(names).toEqual([
      `electris-v${version}-SHA256SUMS.txt`,
      `electris-v${version}-linux-x64-portable.tar.gz`,
      `electris-v${version}-release-manifest.json`,
      `electris-v${version}-win32-x64-portable.zip`
    ].sort())
    expect(names.some((name) => name.includes('darwin'))).toBe(false)

    const complete = names.map((name) => ({name, size: 1}))
    expect(assertExactAssetSet(complete, version)).toEqual(names)
    expect(() => assertExactAssetSet(complete.slice(1), version)).toThrow(/missing=\[electris-v.*SHA256SUMS/)
    expect(() => assertExactAssetSet([...complete, {name: `electris-v${version}-darwin-arm64.zip`, size: 1}], version))
      .toThrow(/extra=\[electris-v.*darwin-arm64\.zip\]/)
    expect(() => assertExactAssetSet([...complete, complete[0]], version)).toThrow(/duplicate asset names/)
  })

  it('binds downloads to the canonical anonymous public URL', () => {
    expect(publicDownloadUrl(repository, tag, 'asset.txt'))
      .toBe(`https://github.com/jareddgotte/electris/releases/download/${tag}/asset.txt`)
    expect(() => publicDownloadUrl('not-an-owner-name-pair', tag, 'asset.txt')).toThrow(/owner\/name/)
  })
})

describe('published release download', () => {
  let temporaryRoot: string
  let assetsDirectory: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-verify-published-'))
    assetsDirectory = createPublicRelease(temporaryRoot)
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  let downloads = 0

  function download(overrides: Partial<ApiRelease> = {}, mutate?: (name: string, bytes: Buffer) => Buffer | number) {
    downloads += 1
    return downloadPublishedRelease({
      tag,
      releaseId: '365952827',
      repository,
      output: path.join(temporaryRoot, `downloaded-${downloads}`),
      records: path.join(temporaryRoot, `records-${downloads}`)
    }, {
      client: new FakeClient([publishedRelease(assetsDirectory, overrides)]),
      fetch: fakeFetch(assetsDirectory, mutate)
    })
  }

  it('writes exactly the four public assets and one identity record', async () => {
    const {record, output, recordPath} = await download()

    expect(fs.readdirSync(output).sort()).toEqual(expectedAssetNames(version))
    expect(path.basename(recordPath)).toBe('release-identity.json')
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8'))).toEqual(record)
    expect(record.releaseId).toBe(365952827)
    expect(record.release.publishedAt).toBe('2026-08-06T06:08:29Z')
    expect(record.assets.map((asset) => asset.name)).toEqual(expectedAssetNames(version))
    for (const asset of record.assets) {
      expect(asset.sha256).toBe(hash(fs.readFileSync(path.join(output, asset.name))))
    }
    expect(fs.statSync(recordPath).size).toBeLessThan(4096)
  })

  it('rejects a wrong release ID, a draft, and a malformed selector', async () => {
    await expect(download({id: 365762809})).rejects.toThrow(/not the selected 365952827/)
    await expect(download({draft: true, published_at: null})).rejects.toThrow(/still a draft/)
    await expect(downloadPublishedRelease({
      tag,
      releaseId: '0',
      repository,
      output: path.join(temporaryRoot, 'never'),
      records: path.join(temporaryRoot, 'never-records')
    }, {client: new FakeClient([]), fetch: fakeFetch(assetsDirectory)}))
      .rejects.toThrow(/release ID must be one positive integer/)
    expect(fs.existsSync(path.join(temporaryRoot, 'never'))).toBe(false)
  })

  it('fails closed on a redirected URL, a short body, a bad digest, or an HTTP error', async () => {
    await expect(download({
      assets: publishedRelease(assetsDirectory).assets.map((asset, index) => index === 0
        ? {...asset, browser_download_url: 'https://mirror.example/electris.tar.gz'}
        : asset)
    })).rejects.toThrow(/is served from https:\/\/mirror\.example/)

    await expect(download({}, (name, bytes) => name.endsWith('.txt') ? bytes.subarray(1) : bytes))
      .rejects.toThrow(/returned \d+ bytes, release reports/)

    await expect(download({
      assets: publishedRelease(assetsDirectory).assets.map((asset, index) => index === 0
        ? {...asset, digest: `sha256:${'0'.repeat(64)}`}
        : asset)
    })).rejects.toThrow(/digest is sha256:0{64}/)

    await expect(download({}, (name, bytes) => name.endsWith('.json') ? 404 : bytes))
      .rejects.toThrow(/failed with HTTP 404/)

    await expect(download({
      assets: publishedRelease(assetsDirectory).assets.map((asset, index) => index === 0
        ? {...asset, state: 'starter'}
        : asset)
    })).rejects.toThrow(/in state starter, not uploaded/)
  })

  it('never downloads over an existing tree', async () => {
    const output = path.join(temporaryRoot, 'occupied')
    writeFile(path.join(output, 'previous.txt'), 'earlier verification')
    await expect(downloadPublishedRelease({
      tag,
      releaseId: '365952827',
      repository,
      output,
      records: path.join(temporaryRoot, 'records')
    }, {
      client: new FakeClient([publishedRelease(assetsDirectory)]),
      fetch: fakeFetch(assetsDirectory)
    })).rejects.toThrow(/already exists and is not empty/)
    expect(fs.readdirSync(output)).toEqual(['previous.txt'])
  })
})

describe('safe extraction of a verified public archive', () => {
  let temporaryRoot: string
  let assetsDirectory: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-verify-extract-'))
    assetsDirectory = createPublicRelease(temporaryRoot)
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  function extract(overrides: Record<string, string> = {}) {
    return extractPublicArchive({
      tag,
      commit,
      target: 'linux-x64',
      dir: assetsDirectory,
      output: path.join(temporaryRoot, 'extracted'),
      ...overrides
    })
  }

  it('extracts only the one expected top-level package directory', () => {
    const packagePath = extract()
    expect(packagePath).toBe(path.join(temporaryRoot, 'extracted', packageDirectoryName))
    expect(fs.readdirSync(path.join(temporaryRoot, 'extracted'))).toEqual([packageDirectoryName])
    expect(fs.existsSync(path.join(packagePath, 'electris'))).toBe(true)
  })

  it('verifies the whole public asset set before opening any archive', () => {
    fs.appendFileSync(path.join(assetsDirectory, linuxArchiveName), 'tampered')
    expect(() => extract()).toThrow(/SHA-256 mismatch for electris-v.*linux-x64-portable\.tar\.gz/)
    expect(fs.existsSync(path.join(temporaryRoot, 'extracted'))).toBe(false)
  })

  it('rejects an unexpected commit, a non-public target, and an occupied destination', () => {
    expect(() => extract({commit: 'c'.repeat(40)})).toThrow(/manifest identity does not match/)
    expect(() => extract({target: 'darwin-arm64'})).toThrow(/not a public release target/)
    expect(() => extract({target: 'linux-arm64'})).toThrow(/not a public release target/)

    const occupied = path.join(temporaryRoot, 'occupied')
    writeFile(path.join(occupied, packageDirectoryName, 'stale'), 'earlier extraction')
    expect(() => extract({output: occupied})).toThrow(/already exists and is not empty/)
    expect(fs.readdirSync(path.join(occupied, packageDirectoryName))).toEqual(['stale'])
  })
})

describe('compact published-release verification records', () => {
  let temporaryRoot: string
  let recordsRoot: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-verify-record-'))
    recordsRoot = path.join(temporaryRoot, 'records')
    writeFile(path.join(recordsRoot, 'release-identity.json'), `${JSON.stringify({
      schemaVersion: 1,
      tag,
      releaseId: 365952827,
      repository,
      packageVersion: version,
      release: {draft: false, prerelease: true, publishedAt: '2026-08-06T06:08:29Z'},
      assets: [{id: 503466504, name: linuxArchiveName, size: 125076917, sha256: 'c'.repeat(64)}]
    }, null, 2)}\n`)
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  function write(values: Partial<PackageRecord> = {}, overrides: Record<string, string> = {}) {
    return writeVerificationRecord({
      tag,
      releaseId: '365952827',
      commit,
      runner: 'ubuntu-latest',
      artifact: 'unused-artifact',
      records: recordsRoot,
      ...overrides
    }, {verifyArtifact: () => ({record: packageRecord(values)})})
  }

  it('records the release, archive, package, and matching-host smoke identity together', () => {
    const outputPath = write()
    expect(path.basename(outputPath)).toBe('verified-linux-x64.json')
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      tag,
      releaseId: 365952827,
      commit,
      repository,
      publishedAt: '2026-08-06T06:08:29Z',
      runner: 'ubuntu-latest',
      target: {platform: 'linux', arch: 'x64'},
      archive: {basename: linuxArchiveName, bytes: 125076917, sha256: 'c'.repeat(64)},
      package: {name: 'electris', version, electronVersion: '43.2.0'},
      smoke: {passed: true, evidence: smokeEvidence}
    })
    expect(fs.statSync(outputPath).size).toBeLessThan(1024)
  })

  it('refuses anything but a proven matching-host smoke of the selected release', () => {
    expect(() => write({launchedOnTargetOs: false})).toThrow(/did not record the bounded smoke/)
    expect(() => write({smokeEvidence: 'looked fine'})).toThrow(/did not record the bounded smoke/)
    expect(() => write({launchPlatform: 'win32'})).toThrow(/did not record the bounded smoke/)
    expect(() => write({version: '0.1.2'})).toThrow(/is version 0\.1\.2, tag/)
    expect(() => write({platform: 'win32', launchPlatform: 'win32'}))
      .toThrow(/is win32\/x64, runner ubuntu-latest verifies linux\/x64/)
    expect(() => write({}, {runner: 'ubuntu-24.04'})).toThrow(/unreviewed runner label/)
    expect(() => write({}, {runner: 'macos-15'})).toThrow(/not a public release target host/)
    expect(() => write({}, {commit: 'master'})).toThrow(/full lowercase Git SHA/)
    expect(() => write({}, {releaseId: '365762809'})).toThrow(/does not describe the selected release/)
    expect(fs.readdirSync(recordsRoot)).toEqual(['release-identity.json'])
  })
})

describe('published-release verification command surface', () => {
  it('accepts only the exact argument set of each subcommand', () => {
    expect(parseOptions(['publish', '--tag=v1.0.0'])).toBeNull()
    expect(parseOptions(['download', `--tag=${tag}`, '--release-id=1', `--repository=${repository}`,
      '--output=assets'])).toBeNull()
    expect(parseOptions(['download', `--tag=${tag}`, '--release-id=1', `--repository=${repository}`,
      '--output=assets', '--records=records', '--commit=abc'])).toBeNull()
    expect(parseOptions(['download', `--tag=${tag}`, '--release-id=1', `--repository=${repository}`,
      '--output=assets', '--records=records'])).toMatchObject({command: 'download', releaseId: '1'})
    expect(parseOptions(['extract', `--tag=${tag}`, `--commit=${commit}`, '--target=linux-x64',
      '--dir=assets', '--output=extract'])).toMatchObject({command: 'extract'})
    expect(parseOptions(['record', `--tag=${tag}`, '--release-id=1', `--commit=${commit}`,
      '--runner=ubuntu-latest', '--artifact=pkg', '--records=records'])).toMatchObject({command: 'record'})
  })
})

describe('published release verification workflow contract', () => {
  const workflowsRoot = path.join(process.cwd(), '.github', 'workflows')
  const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-verify-published.yml'), 'utf8')
  const releaseWorkflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')

  function matchingLines(content: string, fragment: string) {
    return content.split('\n').filter((line) => line.includes(fragment))
  }

  it('is manual-only and rejects every ref and workflow source except protected master', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:\n/m)
    expect(workflow).not.toMatch(/\n {2}(?:push|pull_request|pull_request_target|issue_comment|schedule):/)
    expect(workflow).toContain("github.ref == 'refs/heads/master'")
    expect(workflow).toContain("github.event.repository.default_branch == 'master'")
    expect(workflow).toContain("release-verify-published.yml@refs/heads/master', github.repository")
    expect(workflow).toContain('ref: refs/tags/${{ inputs.tag }}')
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$tag_sha"')
    expect(workflow).toContain('git merge-base --is-ancestor HEAD refs/remotes/origin/master')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow.indexOf('Establish trusted tag ancestry'))
      .toBeLessThan(workflow.indexOf('Use declared Node version'))
  })

  it('requires an exact tag, release ID, and typed confirmation before checkout', () => {
    const selector = workflow.slice(workflow.indexOf('- name: Validate selector'),
        workflow.indexOf('- name: Check out'))
    expect([...workflow.matchAll(/^ {6}([a-z_]+):\n {8}description:/gm)].map((match) => match[1]))
      .toEqual(['tag', 'release_id', 'confirmation'])
    expect(workflow).toContain('      tag:\n        description: Exact published strict-SemVer tag to verify')
    expect(workflow).toContain('      release_id:\n        description: Exact GitHub Release ID')
    expect(selector).toContain("'verify ' + tag + ' ' + id")
    expect(selector).toContain('!/^[1-9][0-9]*\\$/.test(id)')
    // The escaped SemVer pattern and $GITHUB_OUTPUT append only behave identically on
    // every runner under an explicit shell, so the guard cannot silently weaken on
    // Windows before any repository code has been selected.
    expect(selector).toContain('shell: bash')
    expect(matchingLines(workflow, 'shell: bash')).toHaveLength(2)
    expect(workflow.indexOf('- name: Validate selector')).toBeLessThan(workflow.indexOf('uses: actions/checkout@'))
    // Neither raw dispatch input reaches a run command; later steps consume only the
    // validated selector output and the script-validated release identity outputs.
    const runSteps = workflow.slice(workflow.indexOf('- name: Check out'))
    expect(runSteps).not.toContain('inputs.release_id')
    expect(runSteps).not.toContain('inputs.confirmation')
    expect(matchingLines(runSteps, 'inputs.tag').every((line) => /RELEASE_TAG:|ref: refs\/tags\//.test(line))).toBe(true)
  })

  it('keeps permissions, credentials, environments, and secrets read-only', () => {
    expect(matchingLines(workflow, 'contents: read')).toHaveLength(1)
    expect(workflow).not.toMatch(/\bcontents: write\b|\bid-token: write\b|\bactions: write\b|\bpackages: write\b/)
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).not.toMatch(/^\s*environment:/m)
    expect(workflow).not.toMatch(/release-(?:publish|signing)|\$\{\{\s*secrets\.|ELECTRIS_CANARY_|vars\./)
    expect(matchingLines(workflow, 'github.token')).toEqual(['          GITHUB_TOKEN: ${{ github.token }}'])
    for (const line of matchingLines(workflow, 'uses:')) {
      expect(line).toMatch(/uses: [^@\s]+@[0-9a-f]{40}(?:\s|$)/)
    }
  })

  it('mutates nothing: no tag, release, draft, asset, or package write path', () => {
    expect(workflow).not.toMatch(
        /release-github\.cjs|release-archive\.cjs|sync-draft|publishDraft|gh release|gh api|npm publish|git (?:tag|push)/)
    expect(workflow).not.toMatch(/package:host|package:target|npm run (?:package|start|build|smoke)/)
    expect(workflow).toContain('node scripts/release-assets.cjs')
    expect(workflow).not.toContain('--input=')
  })

  it('verifies only the two claimed public targets on their exact native hosts', () => {
    const targets = [...workflow.matchAll(/- runner: ([^\n]+)\n\s+platform: ([^\n]+)\n\s+arch: ([^\n]+)/g)]
      .map((match) => ({runner: match[1], platform: match[2], arch: match[3]}))
    expect(targets).toEqual([
      {runner: 'ubuntu-latest', platform: 'linux', arch: 'x64'},
      {runner: 'windows-latest', platform: 'win32', arch: 'x64'}
    ])
    expect(targets.map(({platform, arch}) => targetKey(platform, arch)))
      .toEqual(releaseTargets.filter((target) => target.public).map(({platform, arch}) => targetKey(platform, arch)))
    const assertion = matchingLines(releaseWorkflow, 'run: node -e "if (process.platform !==')[0].trim()
    expect(matchingLines(workflow, 'run: node -e "if (process.platform !==').map((line) => line.trim()))
      .toEqual([assertion])
    expect(workflow).toContain('fail-fast: false')
  })

  it('downloads, verifies, extracts, verifies, bounded-smokes, and verifies in that order', () => {
    const order = [
      'node scripts/release-verify-published.cjs download',
      'node scripts/release-assets.cjs',
      'node scripts/release-verify-published.cjs extract',
      'node scripts/package-verify.cjs "${{ steps.extract.outputs.package-path }}"',
      'node scripts/package-smoke.cjs "${{ steps.extract.outputs.package-path }}"',
      'node scripts/package-verify.cjs "${{ steps.extract.outputs.package-path }}"',
      'node scripts/release-verify-published.cjs record'
    ]
    let cursor = -1
    for (const command of order) {
      const next = workflow.indexOf(command, cursor + 1)
      expect(next, command).toBeGreaterThan(cursor)
      cursor = next
    }
    // The bounded harness is the only launch path; a direct or unbounded run of the
    // published executable would not be the verification RELEASING.md documents.
    expect(matchingLines(workflow, 'package-smoke.cjs')).toHaveLength(1)
    expect(workflow).not.toMatch(/electris(?:\.exe)?["'\s]*$/m)
    // Every argument is a quoted expression, so no host shell expands a release path.
    expect(workflow).not.toMatch(/\$(?:RELEASE_ID|PACKAGE_PATH|RELEASE_SHA)\b/)
  })

  it('retains only compact, ignored JSON evidence for seven days', () => {
    expect(matchingLines(workflow, 'actions/upload-artifact@')).toHaveLength(1)
    const upload = workflow.slice(workflow.indexOf('actions/upload-artifact@'))
    expect(upload).toContain('path: verification-records/*.json')
    expect(upload).toContain('if-no-files-found: error')
    expect(upload).toContain('retention-days: 7')
    expect(upload).not.toMatch(/published-release-assets|published-release-extract|\.(?:zip|tar|gz|dmg|exe)\b/)
    const ignored = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    for (const directory of ['/verification-records/', '/published-release-assets/', '/published-release-extract/']) {
      expect(ignored).toContain(directory)
    }
  })
})
