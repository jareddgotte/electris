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
  assertTargetCanary,
  authorizedCanary,
  partialDraftCanaryEnabled,
  targetFailureCanaryEnabled
} = require('../scripts/release-canary.cjs') as {
  assertTargetCanary: (options: {value?: string, tag?: string, target?: string}) => void
  authorizedCanary: {
    tag: string
    target: string
    targetFailureValue: string
    stopAfterUploadValue: string
  }
  partialDraftCanaryEnabled: (value: string | undefined, tag: string) => boolean
  targetFailureCanaryEnabled: (value: string | undefined, tag: string, target: string) => boolean
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

const tag = 'v0.2.0-rc.2'
const version = '0.2.0-rc.2'
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
  uploadFailure: Error | null = null

  async request(method: string, url: string, options: Record<string, any> = {}) {
    this.calls.push({method, url, options})
    if (method === 'GET' && url.includes('/releases/tags/')) return this.release
    if (method === 'GET' && url.startsWith('asset://')) return this.bytes.get(url)
    if (method === 'GET' && url.includes('/actions/runs/')) return this.run
    if (method === 'POST' && url.endsWith('/releases')) {
      this.release = {id: 7, assets: [], ...options.body}
      return this.release
    }
    if (method === 'POST' && url.startsWith('https://uploads.github.com/')) {
      if (this.uploadFailure) throw this.uploadFailure
      const name = new URL(url).searchParams.get('name')
      if (!name || !this.release) throw new Error('Upload requires an asset name and release')
      const body = Buffer.from(options.body)
      const assetUrl = `asset://uploaded-${this.release.assets.length}`
      const asset = {id: 8 + this.release.assets.length, name, size: body.length, url: assetUrl}
      this.bytes.set(assetUrl, body)
      this.release.assets.push(asset)
      return asset
    }
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
    expect(parseReleaseTag(tag)).toMatchObject({version, prerelease: 'rc.2'})
    expect(parseReleaseTag('v1.0.0-2be')).toMatchObject({version: '1.0.0-2be', prerelease: '2be'})
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
    git('tag', 'v0.2.0-rc.3')
    expect(() => validateGitIdentity('v0.2.0-rc.3', {
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
    expect(workflow).toContain('runner: macos-15\n            platform: darwin\n            arch: arm64')
    expect(workflow).toContain('runner: macos-15-intel\n            platform: darwin\n            arch: x64')
  })

  it('requires a recovery dispatch to select the same tag workflow before checkout', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const selector = workflow.indexOf('Reject non-tag selectors before running selected repository code')
    const guard = workflow.indexOf('Require manual recovery to run the selected tag workflow')
    const checkout = workflow.indexOf('Check out the selected existing tag')
    const guardBlock = workflow.slice(guard, checkout)

    expect(selector).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(selector)
    expect(checkout).toBeGreaterThan(guard)
    expect(guardBlock).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(guardBlock).toContain('RELEASE_TAG: ${{ inputs.tag }}')
    expect(guardBlock).toContain('SELECTED_REF: ${{ github.ref }}')
    expect(guardBlock).toContain("process.env.SELECTED_REF !== 'refs/tags/' + process.env.RELEASE_TAG")
  })

  it('passes every cross-platform package argument without host-shell expansion', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const packageJob = workflow.slice(workflow.indexOf('  package:'), workflow.indexOf('  assemble-draft:'))
    const packagePathArgument = '"${{ steps.package-path.outputs.path }}"'
    const packageCommands = packageJob.split('\n').map((line) => line.trim())
        .filter((line) => /^run: node scripts\/package-(?:verify|smoke)\.cjs/.test(line))
    const archiveBlock = packageJob.slice(
        packageJob.indexOf('- name: Archive, extract, and verify final package bytes'),
        packageJob.indexOf('- name: Retain target qualification evidence'))
    const archiveArguments = [
      '"--artifact=${{ steps.package-path.outputs.path }}"',
      '"--output=release-work/${{ matrix.platform }}-${{ matrix.arch }}"',
      '"--tag=${{ needs.identity.outputs.tag }}"',
      '"--commit=${{ needs.identity.outputs.sha }}"',
      '"--run-id=${{ github.run_id }}"',
      '"--run-url=${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"'
    ]

    expect(packageJob).not.toMatch(
        /\$(?:PACKAGE_PATH|RELEASE_OUTPUT|RELEASE_TAG|RELEASE_SHA|GITHUB_RUN_ID|RELEASE_RUN_URL)\b/)
    expect(packageJob).toContain('id: package-path')
    expect(packageJob.split(packagePathArgument)).toHaveLength(4)
    expect(packageCommands).toEqual([
      `run: node scripts/package-verify.cjs ${packagePathArgument}`,
      `run: node scripts/package-smoke.cjs ${packagePathArgument}`,
      `run: node scripts/package-verify.cjs ${packagePathArgument}`
    ])
    expect(archiveBlock.split('\n').map((line) => line.trim())
        .filter((line) => line.startsWith('"--'))).toEqual(archiveArguments)
  })

  it('keeps both temporary canaries inside fail-closed preparation paths', () => {
    const prepare = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const publish = fs.readFileSync(path.join(workflowsRoot, 'release-publish.yml'), 'utf8')
    const packageStart = prepare.indexOf('  package:')
    const targetHook = prepare.indexOf('Apply exact-tag selected-target failure canary')
    const packageBuild = prepare.indexOf('Build package on its native host')
    const assembleStart = prepare.indexOf('  assemble-draft:')
    const uploadHook = prepare.indexOf('ELECTRIS_CANARY_STOP_AFTER_UPLOAD:')

    expect(packageStart).toBeGreaterThan(-1)
    expect(targetHook).toBeGreaterThan(packageStart)
    expect(packageBuild).toBeGreaterThan(targetHook)
    expect(assembleStart).toBeGreaterThan(packageBuild)
    expect(prepare.slice(assembleStart)).toContain('needs: [identity, package]')
    expect(uploadHook).toBeGreaterThan(assembleStart)
    expect(prepare).toContain('ELECTRIS_CANARY_FAIL_TARGET: ${{ vars.ELECTRIS_CANARY_FAIL_TARGET }}')
    expect(prepare).toContain('ELECTRIS_CANARY_STOP_AFTER_UPLOAD: ${{ vars.ELECTRIS_CANARY_STOP_AFTER_UPLOAD }}')
    expect(publish).not.toMatch(/ELECTRIS_CANARY_|vars\./)
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

describe('temporary exact-tag release canaries', () => {
  it('fixes the reviewed authorization to one tag, target, and value pair', () => {
    expect(authorizedCanary).toEqual({
      tag: 'v0.2.0-rc.2',
      target: 'linux-x64',
      targetFailureValue: 'v0.2.0-rc.2:linux-x64',
      stopAfterUploadValue: 'v0.2.0-rc.2:after-one-upload'
    })
  })

  it.each([
    undefined,
    '',
    'true',
    'v0.2.0-rc.2',
    'v0.2.0-rc.1:linux-x64',
    'v0.2.0-rc.3:linux-x64',
    'v0.2.0-rc.2:win32-x64',
    'v0.2.0-rc.2:linux-x64:extra',
    ' v0.2.0-rc.2:linux-x64',
    'v0.2.0-rc.2:linux-x64 '
  ])('leaves absent, malformed, rc.1, other-tag, wrong-target, and near-match target values inert: %s', (value) => {
    expect(targetFailureCanaryEnabled(value, tag, authorizedCanary.target)).toBe(false)
  })

  it('fails only the exact authorized tag and reviewed target tuple', () => {
    expect(targetFailureCanaryEnabled(authorizedCanary.targetFailureValue, tag, authorizedCanary.target)).toBe(true)
    expect(targetFailureCanaryEnabled(authorizedCanary.targetFailureValue, 'v0.2.0-rc.1', authorizedCanary.target)).toBe(false)
    expect(targetFailureCanaryEnabled(authorizedCanary.targetFailureValue, 'v0.2.0-rc.3', authorizedCanary.target)).toBe(false)
    expect(targetFailureCanaryEnabled(authorizedCanary.targetFailureValue, tag, 'win32-x64')).toBe(false)
    expect(partialDraftCanaryEnabled(authorizedCanary.targetFailureValue, tag)).toBe(false)
    expect(() => assertTargetCanary({
      value: authorizedCanary.targetFailureValue,
      tag,
      target: authorizedCanary.target
    })).toThrow(/intentionally failed v0\.2\.0-rc\.2\/linux-x64/)
  })

  it('wires the exact workflow environment names through the target CLI entrypoint', () => {
    const result = spawnSync(process.execPath, ['scripts/release-canary.cjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ELECTRIS_CANARY_FAIL_TARGET: authorizedCanary.targetFailureValue,
        RELEASE_TAG: tag,
        RELEASE_TARGET: authorizedCanary.target
      }
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/intentionally failed v0\.2\.0-rc\.2\/linux-x64/)
  })

  it.each([
    undefined,
    '',
    'true',
    'v0.2.0-rc.2',
    'v0.2.0-rc.1:after-one-upload',
    'v0.2.0-rc.3:after-one-upload',
    'v0.2.0-rc.2:after-two-uploads',
    'v0.2.0-rc.2:after-one-upload:extra',
    ' v0.2.0-rc.2:after-one-upload',
    'v0.2.0-rc.2:after-one-upload '
  ])('leaves absent, malformed, rc.1, other-tag, and near-match upload values inert: %s', (value) => {
    expect(partialDraftCanaryEnabled(value, tag)).toBe(false)
  })

  it('enables partial-draft failure only for the exact authorized tag and value', () => {
    expect(partialDraftCanaryEnabled(authorizedCanary.stopAfterUploadValue, tag)).toBe(true)
    expect(partialDraftCanaryEnabled(authorizedCanary.stopAfterUploadValue, 'v0.2.0-rc.1')).toBe(false)
    expect(partialDraftCanaryEnabled(authorizedCanary.stopAfterUploadValue, 'v0.2.0-rc.3')).toBe(false)
    expect(targetFailureCanaryEnabled(
        authorizedCanary.stopAfterUploadValue, tag, authorizedCanary.target)).toBe(false)
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

  it('wires the exact workflow environment name through the draft-sync CLI entrypoint', () => {
    const fetchMock = path.join(temporaryRoot, 'mock-github-fetch.cjs')
    writeFile(fetchMock, `
      global.fetch = async (url, options = {}) => {
        const response = (status, body) => ({
          status,
          ok: status >= 200 && status < 300,
          async json() { return body },
          async text() { return JSON.stringify(body) },
          async arrayBuffer() { return Buffer.alloc(0) }
        })
        if (options.method === 'GET' && String(url).includes('/releases/tags/')) return response(404, {})
        if (options.method === 'POST' && String(url).endsWith('/releases')) {
          return response(201, {id: 7, assets: [], ...JSON.parse(options.body)})
        }
        if (options.method === 'POST' && String(url).startsWith('https://uploads.github.com/')) {
          return response(201, {id: 8})
        }
        return response(500, {error: 'unexpected mocked request'})
      }
    `)
    const result = spawnSync(process.execPath, [
      '--require', fetchMock,
      path.join(process.cwd(), 'scripts', 'release-github.cjs'),
      'sync-draft',
      `--tag=${tag}`,
      `--commit=${commit}`,
      '--repository=owner/repo',
      `--assets=${assets}`
    ], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ELECTRIS_CANARY_STOP_AFTER_UPLOAD: authorizedCanary.stopAfterUploadValue,
        GITHUB_TOKEN: 'test-token'
      }
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/after one successful expected-asset upload/)
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
    expect(uploads.some((call) => new URL(call.url).searchParams.get('name') === firstName)).toBe(false)
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('does not report the bounded stop before an expected upload succeeds', async () => {
    const client = new FakeClient()
    client.uploadFailure = new Error('simulated expected-asset upload failure')
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})).rejects.toThrow('simulated expected-asset upload failure')
    expect(client.release).toMatchObject({draft: true, assets: []})
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('stops after one successful expected upload, then retries without replacing it', async () => {
    const client = new FakeClient()
    const expectedNames = fs.readdirSync(assets).sort()
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})).rejects.toThrow(/after one successful expected-asset upload/)

    expect(client.release).toMatchObject({draft: true, prerelease: true})
    expect(client.release?.assets).toHaveLength(1)
    expect(client.release?.assets[0].name).toBe(expectedNames[0])
    expect(client.bytes.get(client.release?.assets[0].url))
      .toEqual(fs.readFileSync(path.join(assets, expectedNames[0])))
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)

    await syncDraft({tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client})
    expect(client.release?.assets.map((asset: ApiAsset) => asset.name).sort()).toEqual(expectedNames)
    const uploadsAfterRecovery = client.calls
        .filter((call) => call.method === 'POST' && call.url.startsWith('https://uploads.github.com/'))
    expect(uploadsAfterRecovery).toHaveLength(expectedNames.length)
    expect(uploadsAfterRecovery.filter((call) =>
      new URL(call.url).searchParams.get('name') === expectedNames[0])).toHaveLength(1)

    await syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})
    const uploadsAfterIdempotentRetry = client.calls
        .filter((call) => call.method === 'POST' && call.url.startsWith('https://uploads.github.com/'))
    expect(uploadsAfterIdempotentRetry).toHaveLength(expectedNames.length)
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('accepts exact-head push and recovery runs but rejects newer-master or failed heads', async () => {
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
    client.run = {...client.run, event: 'workflow_dispatch'}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toMatchObject({draft: false, prerelease: true, make_latest: 'false'})

    client.run = {...client.run, head_sha: 'b'.repeat(40)}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not a successful allowed run/)

    client.run = {...client.run, head_sha: commit, conclusion: 'failure'}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not a successful allowed run/)
  })

  it('rejects different bytes and unexpected existing assets without any write or clobber request', async () => {
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
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})).rejects.toThrow(/bytes differ/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)

    client.calls = []
    client.release.assets = [{name: 'unexpected.bin', size: 1, url: 'asset://extra'}]
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})).rejects.toThrow(/unexpected assets/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
    expect(client.release.assets).toEqual([{name: 'unexpected.bin', size: 1, url: 'asset://extra'}])
  })
})

describe('release GitHub and asset scripts stay dependency-free of @electron/asar', () => {
  it('loads release-github.cjs and release-assets.cjs when @electron/asar cannot resolve', () => {
    const probe = `
      const Module = require('module')
      const originalResolve = Module._resolveFilename
      Module._resolveFilename = function (request, ...args) {
        if (request === '@electron/asar') throw new Error('MODULE_NOT_FOUND: simulated missing @electron/asar')
        return originalResolve.call(this, request, ...args)
      }
      require('./scripts/release-github.cjs')
      require('./scripts/release-assets.cjs')
    `
    const result = spawnSync(process.execPath, ['-e', probe], {cwd: process.cwd(), encoding: 'utf8'})
    expect(result.status, result.stderr).toBe(0)
  })
})
