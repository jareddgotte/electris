import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  nativeBuildVersion,
  parseReleaseTag,
  validateFiles,
  validateGitIdentity
} = require('../scripts/release-identity.cjs') as {
  nativeBuildVersion: (version: string) => string
  parseReleaseTag: (tag: string) => {version: string, prerelease: string | null}
  validateFiles: (tag: string, root: string) => unknown
  validateGitIdentity: (tag: string, options: {sourceRoot: string, masterRef?: string}) => unknown
}
const { inspectArchive } = require('../scripts/release-archive.cjs') as {
  inspectArchive: (
    archive: string,
    expectedDirectory: string,
    operations?: {spawnSync: () => {status: number, stdout: string, stderr: string}}
  ) => string[]
}
const {
  assembleReleaseAssets,
  parseChecksums,
  verifyReleaseSet
} = require('../scripts/release-assets.cjs') as {
  assembleReleaseAssets: (options: Record<string, string>) => {manifest: ReleaseManifest}
  parseChecksums: (content: string) => Map<string, string>
  verifyReleaseSet: (directory: string, tag: string, commit: string) => ReleaseManifest
}
const {
  assertReleaseIdentity,
  preflight,
  publicationUpdate,
  publishDraft,
  syncDraft
} = require('../scripts/release-github.cjs') as {
  assertReleaseIdentity: (release: Record<string, unknown>, identity: Record<string, unknown>, body?: string) => void
  preflight: (options: Record<string, string>, operations: {client: FakeClient}) => Promise<unknown>
  publicationUpdate: (tag: string) => {draft: boolean, prerelease: boolean, make_latest: string}
  publishDraft: (options: Record<string, string>, operations: {client: FakeClient}) => Promise<unknown>
  syncDraft: (options: Record<string, string>, operations: {client: FakeClient}) => Promise<unknown>
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

interface ReleaseTarget {
  platform: string
  arch: string
  extension: string
  portable: boolean
  public: boolean
}
interface ReleaseManifest {
  targets: Array<{target: {key: string}}>
}
interface ApiAsset {name: string, size: number, url: string}

const tag = 'v0.2.0-rc.1'
const version = '0.2.0-rc.1'
const commit = 'a'.repeat(40)

function hash(content: Buffer | string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeFile(filePath: string, content: Buffer | string) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

function writeIdentity(root: string, values: {packageVersion?: string, topLock?: string, rootLock?: string, note?: boolean} = {}) {
  const packageVersion = values.packageVersion || version
  writeFile(path.join(root, 'package.json'), JSON.stringify({version: packageVersion}))
  writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    version: values.topLock || packageVersion,
    packages: {'': {version: values.rootLock || packageVersion}}
  }))
  if (values.note !== false) writeFile(path.join(root, 'docs', 'releases', `${tag}.md`), '# Candidate\n')
}

function createStaging(root: string) {
  const staging = path.join(root, 'staging')
  for (const target of releaseTargets) {
    const key = targetKey(target.platform, target.arch)
    const directory = path.join(staging, key)
    const basename = releaseArchiveName(version, target)
    const bytes = Buffer.from(`archive bytes for ${key}`)
    writeFile(path.join(directory, basename), bytes)
    writeFile(path.join(directory, `release-fragment-${key}.json`), `${JSON.stringify({
      schemaVersion: 1,
      tag,
      commit,
      packageVersion: version,
      electronVersion: '43.2.0',
      workflow: {runId: '123', runUrl: 'https://github.example/runs/123'},
      target: {platform: target.platform, arch: target.arch, key, public: target.public},
      archive: {basename, bytes: bytes.length, sha256: hash(bytes)},
      smoke: {passed: true, evidence: 'bounded matching-host smoke passed'},
      signing: {
        state: 'unsigned',
        notarization: target.platform === 'darwin' ? 'not-notarized' : 'not-applicable'
      },
      archiveTool: {command: 'tar', version: 'test tar 1.0'}
    }, null, 2)}\n`)
  }
  return staging
}

class FakeClient {
  release: Record<string, any> | null = null
  bytes = new Map<string, Buffer>()
  calls: Array<{method: string, url: string, options: Record<string, any>}> = []
  run: Record<string, unknown> | null = null

  async request(method: string, url: string, options: Record<string, any> = {}) {
    this.calls.push({method, url, options})
    if (method === 'GET' && url.includes('/releases/tags/')) return this.release
    if (method === 'GET' && url.startsWith('asset://')) return this.bytes.get(url)
    if (method === 'GET' && url.includes('/actions/runs/')) return this.run
    if (method === 'POST' && url.endsWith('/releases')) {
      this.release = {id: 7, assets: [], ...options.body}
      return this.release
    }
    if (method === 'POST' && url.startsWith('https://uploads.github.com/')) return {id: 8}
    if (method === 'PATCH' && url.includes('/releases/')) return {...this.release, ...options.body}
    throw new Error(`Unexpected fake request: ${method} ${url}`)
  }
}

describe('release identity contract', () => {
  let temporaryRoot: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-release-identity-'))
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  it('accepts stable and approved prerelease strict SemVer tags', () => {
    expect(parseReleaseTag('v0.2.0')).toMatchObject({version: '0.2.0', prerelease: null})
    expect(parseReleaseTag(tag)).toMatchObject({version, prerelease: 'rc.1'})
    expect(nativeBuildVersion(version)).toBe('0.2.0')
  })

  it.each(['0.2.0', 'v01.2.0', 'v0.02.0', 'v0.2.00', 'v0.2.0-01', 'v0.2.0+build', 'v0.2', 'v0.2.0/x'])(
      'rejects malformed, non-tag, leading-zero, or build-metadata identity %s', (invalid) => {
        expect(() => parseReleaseTag(invalid)).toThrow(/strict SemVer|single strict/)
      })

  it('requires package, both lockfile fields, and the exact committed note filename', () => {
    writeIdentity(temporaryRoot)
    expect(() => validateFiles(tag, temporaryRoot)).not.toThrow()

    writeIdentity(temporaryRoot, {rootLock: '0.2.0'})
    expect(() => validateFiles(tag, temporaryRoot)).toThrow(/Both package-lock/)
    writeIdentity(temporaryRoot, {topLock: '0.2.0'})
    expect(() => validateFiles(tag, temporaryRoot)).toThrow(/Both package-lock/)
    writeIdentity(temporaryRoot, {packageVersion: '0.2.0'})
    expect(() => validateFiles(tag, temporaryRoot)).toThrow(/does not match package.json/)
    writeIdentity(temporaryRoot, {note: false})
    fs.rmSync(path.join(temporaryRoot, 'docs'), {recursive: true, force: true})
    expect(() => validateFiles(tag, temporaryRoot)).toThrow(/release notes are missing/)
  })

  it('rejects the archival v0.1.2 collision before resolving Git state', () => {
    expect(() => validateGitIdentity('v0.1.2', {sourceRoot: temporaryRoot, masterRef: 'master'}))
      .toThrow(/immutable archival release/)
  })

  it('requires the checkout to equal the tag and the tag to descend from master', () => {
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: temporaryRoot, encoding: 'utf8'})
      if (result.status !== 0) throw new Error(result.stderr)
    }
    git('init', '-b', 'master')
    git('config', 'user.name', 'Release Test')
    git('config', 'user.email', 'release-test@example.invalid')
    writeFile(path.join(temporaryRoot, 'tracked'), 'master\n')
    git('add', 'tracked')
    git('commit', '-m', 'master')
    git('tag', tag)
    expect(() => validateGitIdentity(tag, {sourceRoot: temporaryRoot, masterRef: 'refs/heads/master'}))
      .not.toThrow()

    writeFile(path.join(temporaryRoot, 'tracked'), 'after tag\n')
    git('commit', '-am', 'after tag')
    expect(() => validateGitIdentity(tag, {sourceRoot: temporaryRoot, masterRef: 'refs/heads/master'}))
      .toThrow(/not tagged commit/)

    git('checkout', '--orphan', 'untrusted')
    git('rm', '-f', 'tracked')
    writeFile(path.join(temporaryRoot, 'untrusted'), 'side\n')
    git('add', 'untrusted')
    git('commit', '-m', 'side')
    git('tag', 'v0.2.0-rc.2')
    expect(() => validateGitIdentity('v0.2.0-rc.2', {
      sourceRoot: temporaryRoot,
      masterRef: 'refs/heads/master'
    })).toThrow(/merge-base .* failed/)
  })
})

describe('release archives and asset manifests', () => {
  let temporaryRoot: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-release-assets-'))
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  it('rejects archive traversal, absolute paths, and multiple top-level roots', () => {
    for (const listing of ['expected/file\n../escape\n', '/absolute\n', 'expected/file\nother/file\n']) {
      expect(() => inspectArchive('unused', 'expected', {
        spawnSync: () => ({status: 0, stdout: listing, stderr: ''})
      })).toThrow(/top-level|absolute/)
    }
  })

  it('uses an archive form that preserves executable modes and symlinks', () => {
    const source = path.join(temporaryRoot, 'electris-v0.2.0-linux-x64')
    writeFile(path.join(source, 'electris'), '#!/bin/sh\n')
    fs.chmodSync(path.join(source, 'electris'), 0o755)
    fs.symlinkSync('electris', path.join(source, 'electris-link'))
    const archive = path.join(temporaryRoot, 'fixture.tar.gz')
    expect(spawnSync('tar', ['-czf', archive, '-C', temporaryRoot, path.basename(source)]).status).toBe(0)
    inspectArchive(archive, path.basename(source))
    const extracted = path.join(temporaryRoot, 'extracted')
    fs.mkdirSync(extracted)
    expect(spawnSync('tar', ['-xf', archive, '-C', extracted]).status).toBe(0)
    expect(fs.lstatSync(path.join(extracted, path.basename(source), 'electris-link')).isSymbolicLink()).toBe(true)
    expect(fs.statSync(path.join(extracted, path.basename(source), 'electris')).mode & 0o111).not.toBe(0)
  })

  it('assembles all required target evidence but exposes only Linux and Windows archives', () => {
    const staging = createStaging(temporaryRoot)
    const output = path.join(temporaryRoot, 'release')
    const {manifest} = assembleReleaseAssets({input: staging, output, tag, commit})

    expect(manifest.targets.map((entry) => entry.target.key))
      .toEqual(['linux-x64', 'win32-x64', 'darwin-arm64', 'darwin-x64'])
    expect(fs.readdirSync(output).sort()).toEqual([
      `electris-${tag}-SHA256SUMS.txt`,
      `electris-${tag}-linux-x64-portable.tar.gz`,
      `electris-${tag}-release-manifest.json`,
      `electris-${tag}-win32-x64-portable.zip`
    ].sort())
    expect(() => verifyReleaseSet(output, tag, commit)).not.toThrow()
    const checksums = parseChecksums(fs.readFileSync(path.join(output, `electris-${tag}-SHA256SUMS.txt`), 'utf8'))
    expect([...checksums.keys()]).toEqual([...checksums.keys()].sort())
    expect([...checksums.keys()]).not.toContain(`electris-${tag}-darwin-arm64.zip`)
  })

  it('fails closed on missing, duplicate, changed, or extra release evidence', () => {
    const staging = createStaging(temporaryRoot)
    fs.rmSync(path.join(staging, 'darwin-x64', 'release-fragment-darwin-x64.json'))
    expect(() => assembleReleaseAssets({input: staging, output: path.join(temporaryRoot, 'one'), tag, commit}))
      .toThrow(/Expected 4 release fragments/)

    const complete = createStaging(path.join(temporaryRoot, 'again'))
    fs.copyFileSync(
        path.join(complete, 'linux-x64', 'release-fragment-linux-x64.json'),
        path.join(complete, 'win32-x64', 'release-fragment-copy.json'))
    expect(() => assembleReleaseAssets({input: complete, output: path.join(temporaryRoot, 'two'), tag, commit}))
      .toThrow(/Expected 4 release fragments/)

    const changed = createStaging(path.join(temporaryRoot, 'changed'))
    fs.appendFileSync(path.join(changed, 'linux-x64', `electris-${tag}-linux-x64-portable.tar.gz`), 'tampered')
    expect(() => assembleReleaseAssets({input: changed, output: path.join(temporaryRoot, 'three'), tag, commit}))
      .toThrow(/bytes differ/)

    const valid = createStaging(path.join(temporaryRoot, 'valid'))
    const output = path.join(temporaryRoot, 'release')
    assembleReleaseAssets({input: valid, output, tag, commit})
    writeFile(path.join(output, 'unexpected.txt'), 'no')
    expect(() => verifyReleaseSet(output, tag, commit)).toThrow(/asset set mismatch/)
  })
})

describe('release workflow security contract', () => {
  const workflowsRoot = path.join(process.cwd(), '.github', 'workflows')

  it('pins every Action by a full commit SHA and disables release checkout credentials', () => {
    for (const name of fs.readdirSync(workflowsRoot).filter((file) => file.endsWith('.yml'))) {
      const workflow = fs.readFileSync(path.join(workflowsRoot, name), 'utf8')
      for (const line of workflow.split('\n').filter((entry) => entry.includes('uses:'))) {
        expect(line).toMatch(/uses: [^@\s]+@[0-9a-f]{40}(?:\s|$)/)
      }
    }
    for (const name of ['release-prepare.yml', 'release-publish.yml']) {
      expect(fs.readFileSync(path.join(workflowsRoot, name), 'utf8')).toContain('persist-credentials: false')
    }
  })

  it('limits preparation to tags/recovery and isolates its only contents write', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    expect(workflow).toContain("- 'v*'")
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/pull_request(?:_target)?:|issue_comment:|branches:/)
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(workflow).not.toContain('id-token: write')
    expect(workflow).toContain('cancel-in-progress: false')
  })

  it('makes publication dispatch-only, environment-gated, and rebuild-free', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-publish.yml'), 'utf8')
    expect(workflow).toContain('environment: release-publish')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/push:|pull_request(?:_target)?:|issue_comment:/)
    expect(workflow).not.toMatch(/npm ci|package:host|package:target|release-archive|release-assets/)
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(workflow).toContain('actions: read')
  })
})

describe('draft release idempotency', () => {
  let temporaryRoot: string
  let assets: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-release-github-'))
    assets = path.join(temporaryRoot, 'release')
    assembleReleaseAssets({input: createStaging(temporaryRoot), output: assets, tag, commit})
    writeFile(path.join(temporaryRoot, 'docs', 'releases', `${tag}.md`), '# Candidate\n')
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  it('keeps prereleases off latest and marks a stable release latest', () => {
    expect(publicationUpdate(tag)).toEqual({draft: false, prerelease: true, make_latest: 'false'})
    expect(publicationUpdate('v0.2.0')).toEqual({draft: false, prerelease: false, make_latest: 'true'})
  })

  it('accepts no release or one matching draft, and rejects published/conflicting identity', async () => {
    const client = new FakeClient()
    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})).resolves.toBeNull()
    const matching = {tag_name: tag, name: tag, target_commitish: commit, prerelease: true, draft: true, body: '# Candidate\n', assets: []}
    client.release = matching
    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})).resolves.toBe(matching)
    expect(() => assertReleaseIdentity({...matching, draft: false}, {
      tag, commit, prerelease: true
    })).toThrow(/already published/)
    expect(() => assertReleaseIdentity({...matching, name: 'wrong-release-name'}, {
      tag, commit, prerelease: true
    })).toThrow(/identity conflicts/)
  })

  it('uploads only missing assets and accepts byte-identical existing assets', async () => {
    const client = new FakeClient()
    const firstName = fs.readdirSync(assets).sort()[0]
    const firstBytes = fs.readFileSync(path.join(assets, firstName))
    const existing: ApiAsset = {name: firstName, size: firstBytes.length, url: 'asset://existing'}
    client.bytes.set(existing.url, firstBytes)
    client.release = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: [existing]
    }
    await syncDraft({tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client})
    const uploads = client.calls.filter((call) => call.method === 'POST' && call.url.startsWith('https://uploads.github.com/'))
    expect(uploads).toHaveLength(fs.readdirSync(assets).length - 1)
  })

  it('revalidates one successful exact-head prepare run before publishing', async () => {
    const client = new FakeClient()
    const releaseAssets = fs.readdirSync(assets).sort().map((name, index) => {
      const bytes = fs.readFileSync(path.join(assets, name))
      const url = `asset://publish-${index}`
      client.bytes.set(url, bytes)
      return {name, size: bytes.length, url}
    })
    client.release = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: releaseAssets
    }
    client.run = {
      head_sha: commit,
      conclusion: 'success',
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})).resolves.toMatchObject({
      draft: false,
      prerelease: true,
      make_latest: 'false'
    })
    client.run = {...client.run, conclusion: 'failure'}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not a successful allowed run/)
  })

  it('rejects different bytes and unexpected existing assets rather than clobbering', async () => {
    const client = new FakeClient()
    const basename = fs.readdirSync(assets).sort()[0]
    client.release = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: [{name: basename, size: fs.statSync(path.join(assets, basename)).size, url: 'asset://different'}]
    }
    client.bytes.set('asset://different', Buffer.alloc(fs.statSync(path.join(assets, basename)).size, 1))
    await expect(syncDraft({tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/bytes differ/)
    client.release.assets = [{name: 'unexpected.bin', size: 1, url: 'asset://extra'}]
    await expect(syncDraft({tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/unexpected assets/)
  })
})
