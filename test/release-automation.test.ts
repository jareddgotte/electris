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
  syncDraft: (
    options: Record<string, string | number>,
    operations: {client: FakeClient, sleep?: (milliseconds: number) => Promise<void>}
  ) => Promise<unknown>
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
  checksumsName,
  releaseArchiveName,
  releaseManifestName,
  releaseTargets,
  targetKey
} = require('../scripts/release-config.cjs') as {
  checksumsName: (version: string) => string
  releaseArchiveName: (version: string, target: ReleaseTarget) => string
  releaseManifestName: (version: string) => string
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
  targets: Array<{target: {key: string}, workflow: {runId: string, runUrl: string}}>
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

function createStaging(root: string, runId = '123') {
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
      workflow: {runId, runUrl: `https://github.example/runs/${runId}`},
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
  releases: Array<Record<string, any>> = []
  releasePages: Map<number, Array<Record<string, any>>> | null = null
  tagLookupRelease: Record<string, any> | null = null
  bytes = new Map<string, Buffer>()
  calls: Array<{method: string, url: string, options: Record<string, any>}> = []
  run: Record<string, unknown> | null = null
  runAttempts = new Map<number, Record<string, unknown> | null>()
  uploadFailure: Error | null = null
  afterCreate: ((created: Record<string, any>, client: FakeClient) => void) | null = null
  beforeList: ((requestNumber: number, client: FakeClient) => void) | null = null
  listRequests = 0
  workflowRuns = new Map<string, Array<Record<string, any>>>()
  workflowRunRequests = 0
  beforeWorkflowRuns: ((requestNumber: number, client: FakeClient) => void) | null = null

  get release() {
    return this.releases[0] || null
  }

  set release(value: Record<string, any> | null) {
    this.releases = value ? [value] : []
  }

  async request(method: string, url: string, options: Record<string, any> = {}) {
    this.calls.push({method, url, options})
    if (method === 'GET' && url.includes('/actions/workflows/')) {
      this.workflowRunRequests += 1
      this.beforeWorkflowRuns?.(this.workflowRunRequests, this)
      const parsed = new URL(url, 'https://api.github.example')
      const file = parsed.pathname.match(/\/actions\/workflows\/([^/]+)\/runs$/)?.[1]
      const page = Number(parsed.searchParams.get('page'))
      const perPage = Number(parsed.searchParams.get('per_page'))
      const runs = this.workflowRuns.get(file || '') || []
      return {total_count: runs.length, workflow_runs: runs.slice((page - 1) * perPage, page * perPage)}
    }
    if (method === 'GET' && url.includes('/releases/tags/')) return this.tagLookupRelease
    if (method === 'GET' && url.includes('/releases?')) {
      this.listRequests += 1
      this.beforeList?.(this.listRequests, this)
      const parsed = new URL(url, 'https://api.github.example')
      const page = Number(parsed.searchParams.get('page'))
      const perPage = Number(parsed.searchParams.get('per_page'))
      if (this.releasePages) return this.releasePages.get(page) || []
      return this.releases.slice((page - 1) * perPage, page * perPage)
    }
    if (method === 'GET' && url.startsWith('asset://')) return this.bytes.get(url)
    if (method === 'GET' && url.includes('/actions/runs/')) {
      const attempt = url.match(/\/actions\/runs\/\d+\/attempts\/(\d+)$/)
      if (attempt) {
        const number = Number(attempt[1])
        if (!this.runAttempts.has(number)) throw new Error(`GitHub API GET ${url} failed (404)`)
        return this.runAttempts.get(number) || null
      }
      return this.run
    }
    if (method === 'POST' && url.endsWith('/releases')) {
      const created = {id: 7, assets: [], ...options.body}
      this.releases.push(created)
      this.afterCreate?.(created, this)
      return created
    }
    if (method === 'POST' && url.startsWith('https://uploads.github.com/')) {
      if (this.uploadFailure) throw this.uploadFailure
      const name = new URL(url).searchParams.get('name')
      const id = Number(url.match(/\/releases\/(\d+)\/assets/)?.[1])
      const release = this.releases.find((candidate) => candidate.id === id)
      if (!name || !release) throw new Error('Upload requires an asset name and bound release ID')
      const body = Buffer.from(options.body)
      const assetUrl = `asset://uploaded-${release.assets.length}`
      const asset = {id: 8 + release.assets.length, name, size: body.length, url: assetUrl}
      this.bytes.set(assetUrl, body)
      release.assets.push(asset)
      return asset
    }
    if (method === 'PATCH' && url.includes('/releases/')) {
      const id = Number(url.match(/\/releases\/(\d+)/)?.[1])
      const release = this.releases.find((candidate) => candidate.id === id)
      if (!release) throw new Error('Publish requires the bound release ID')
      return {...release, ...options.body}
    }
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

  it('limits preparation to tag pushes and isolates every contents write to a job', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    expect(workflow).toContain("- 'v*'")
    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/pull_request(?:_target)?:|issue_comment:|branches:/)
    expect(workflow.match(/^permissions:\n  contents: read$/m)).not.toBeNull()
    expect(workflow.match(/contents: write/g)).toHaveLength(2)
    // Still exactly two contents-writing jobs. Draft assembly additionally reads this
    // repository's own workflow runs so it can refuse while a publication for the same
    // tag is live, so its block is the read-then-write form rather than a third writer.
    expect(workflow.match(/^    permissions:\n      contents: write$/gm)).toHaveLength(1)
    expect(workflow.match(/^    permissions:\n      actions: read\n      contents: write$/gm)).toHaveLength(1)
    expect(workflow.match(/^      actions: read$/gm)).toHaveLength(1)
    expect(workflow).not.toContain('id-token: write')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('runner: macos-15\n            platform: darwin\n            arch: arm64')
    expect(workflow).toContain('runner: macos-15-intel\n            platform: darwin\n            arch: x64')
  })

  it('grants draft visibility only to the discovery preflight job that gates packaging', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const jobs = new Map<string, string>()
    const names = [...workflow.matchAll(/^ {2}([a-z][a-z-]*):$/gm)]
    for (const [index, match] of names.entries()) {
      const start = match.index as number
      jobs.set(match[1], workflow.slice(start, index + 1 < names.length ? names[index + 1].index : workflow.length))
    }
    const preflightJob = jobs.get('preflight') as string

    // Draft releases are invisible to a contents: read token, so the fail-fast
    // exact-tag discovery documented in RELEASING.md needs push access to be true.
    expect(preflightJob).toContain('permissions:\n      contents: write')
    expect(preflightJob).toContain('node scripts/release-github.cjs preflight')
    expect(jobs.get('assemble-draft')).toContain('permissions:\n      actions: read\n      contents: write')
    for (const name of ['identity', 'source-validate', 'package']) {
      expect(jobs.get(name), name).not.toContain('contents: write')
      expect(jobs.get(name), name).not.toContain('release-github.cjs preflight')
    }

    // The elevated job stays a discovery-only gate: it never builds, packages,
    // archives, assembles, or uploads, and every packaging job waits on it.
    expect(preflightJob).not.toMatch(/npm ci|npm run|package:host|release-archive|release-assets|sync-draft|upload-artifact/)
    expect(preflightJob).toContain('persist-credentials: false')
    expect(jobs.get('source-validate')).toContain('needs: [identity, preflight]')
    expect(jobs.get('package')).toContain('needs: [identity, preflight, source-validate]')
  })

  it('rejects unsafe fresh-dispatch recovery and keeps reruns on one workflow run identity', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')

    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).not.toContain('inputs.tag')
    expect(workflow).toContain('"--run-id=${{ github.run_id }}"')
    expect(workflow).toContain('${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}')
    expect(workflow).not.toContain('github.run_attempt')
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

  it('keeps both per-tag concurrency groups and their no-cancel policy unchanged', () => {
    const prepare = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const publish = fs.readFileSync(path.join(workflowsRoot, 'release-publish.yml'), 'utf8')

    // The two groups are deliberately distinct. Sharing one would serialize preparation
    // against publication by queueing, and a publication waiting for environment approval
    // holds its slot far longer than the target artifacts a queued preparation rerun
    // needs. Active-run refusal replaces that queue; the groups must not drift into it.
    expect(prepare).toContain('concurrency:\n  group: release-prepare-${{ github.ref_name }}\n  cancel-in-progress: false\n')
    expect(publish).toContain('concurrency:\n  group: release-publish-${{ inputs.tag }}\n  cancel-in-progress: false\n')
    for (const workflow of [prepare, publish]) {
      expect(workflow.match(/^concurrency:$/gm)).toHaveLength(1)
      expect(workflow.match(/cancel-in-progress: false/g)).toHaveLength(1)
      expect(workflow).not.toContain('cancel-in-progress: true')
      expect(workflow).not.toContain('queue:')
    }
  })

  it('gives draft assembly its own run identity so the publication guard cannot self-reject', () => {
    const workflow = fs.readFileSync(path.join(workflowsRoot, 'release-prepare.yml'), 'utf8')
    const assembleJob = workflow.slice(workflow.indexOf('  assemble-draft:'))
    const syncArguments = assembleJob.slice(assembleJob.indexOf('node scripts/release-github.cjs sync-draft'))
        .split('\n').map((line) => line.trim()).filter((line) => line.startsWith('"--'))

    expect(syncArguments).toEqual([
      '"--tag=$RELEASE_TAG"',
      '"--commit=$RELEASE_SHA"',
      '"--repository=$GITHUB_REPOSITORY"',
      '"--assets=release-assets"',
      '"--run-id=${{ github.run_id }}"'
    ])
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

describe('release note references into release administration', () => {
  const docsRoot = path.join(process.cwd(), 'docs')
  const administration = fs.readFileSync(path.join(docsRoot, 'release-administration.md'), 'utf8')
  const notesRoot = path.join(docsRoot, 'releases')
  const notes = fs.readdirSync(notesRoot).filter((name) => name.endsWith('.md'))

  it('resolves every frozen release-note section pointer, including renamed headings', () => {
    const pointers = notes.flatMap((name) => {
      const content = fs.readFileSync(path.join(notesRoot, name), 'utf8').replace(/\s+/g, ' ')
      return [...content.matchAll(/[Ss]ee "([^"]+)" in \[`\.\.\/release-administration\.md`\]/g)]
          .map((match) => ({name, section: match[1]}))
    })
    const headings = new Set(
        [...administration.matchAll(/^#{2,6} (.+)$/gm)].map((match) => match[1].trim()))

    // Frozen incident-evidence notes are never edited, so a renamed heading must keep
    // resolving from the current administration document instead.
    expect(pointers.map((pointer) => `${pointer.name}: ${pointer.section}`)).toEqual([
      'v0.2.0-rc.1.md: Canary and recovery evidence',
      'v0.2.0-rc.2.md: Canary and recovery proof'
    ])
    for (const {name, section} of pointers) {
      const anchor = section.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      expect(headings.has(section) || administration.includes(`<a id="${anchor}"></a>`), `${name}: ${section}`).toBe(true)
      expect(administration, `${name}: ${section}`).toContain(section)
    }
  })

  it('keeps the renamed section reachable by its former name and anchor', () => {
    const heading = administration.indexOf('## Canary and recovery evidence')
    const alias = administration.indexOf('<a id="canary-and-recovery-proof"></a>')
    const nextHeading = administration.indexOf('\n## ', heading + 1)

    expect(heading).toBeGreaterThan(-1)
    expect(alias).toBeGreaterThan(heading)
    expect(alias).toBeLessThan(nextHeading)
    expect(administration).not.toContain('## Canary and recovery proof')
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

  // A complete, byte-correct draft holding exactly the assembled asset set, so publication
  // tests exercise the prepare-run gate rather than asset verification.
  function publishableDraft(client: FakeClient, label: string, directory = assets) {
    return {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: fs.readdirSync(directory).sort().map((name, index) => {
        const bytes = fs.readFileSync(path.join(directory, name))
        const url = `asset://${label}-${index}`
        client.bytes.set(url, bytes)
        return {id: 20 + index, name, size: bytes.length, url}
      })
    }
  }

  it('keeps prereleases off latest and marks a stable release latest', () => {
    expect(publicationUpdate(tag)).toEqual({draft: false, prerelease: true, make_latest: 'false'})
    expect(publicationUpdate('v0.2.0')).toEqual({draft: false, prerelease: false, make_latest: 'true'})
  })

  it('accepts zero or one exact-tag candidate and rejects a published conflict', async () => {
    const client = new FakeClient()
    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})).resolves.toBeNull()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    client.release = matching
    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toBe(matching)

    client.release = {...matching, draft: false}
    client.calls = []
    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/already published/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
    expect(() => assertReleaseIdentity({...matching, name: 'wrong-release-name'}, {
      tag, commit, prerelease: true
    })).toThrow(/identity conflicts/)
  })

  it('finds a list-visible draft even when the release-by-tag endpoint returns 404', async () => {
    const client = new FakeClient()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    client.release = matching
    expect(await client.request('GET', `/repos/owner/repo/releases/tags/${tag}`)).toBeNull()
    client.calls = []

    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toBe(matching)
    expect(client.calls.some((call) => call.url.includes('/releases/tags/'))).toBe(false)
    expect(client.calls.some((call) => call.url.includes('/releases?per_page=100&page=1'))).toBe(true)
  })

  it('paginates the authenticated release list before selecting one exact-tag draft', async () => {
    const client = new FakeClient()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    client.releasePages = new Map([
      [1, Array.from({length: 100}, (_, index) => ({id: 1000 + index, tag_name: `v9.9.${index}`}))],
      [2, [matching]]
    ])

    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toBe(matching)
    expect(client.calls.filter((call) => call.url.includes('/releases?')).map((call) => call.url)).toEqual([
      '/repos/owner/repo/releases?per_page=100&page=1',
      '/repos/owner/repo/releases?per_page=100&page=2',
      '/repos/owner/repo/releases?per_page=100&page=1',
      '/repos/owner/repo/releases?per_page=100&page=2'
    ])
  })

  it('acts on a multi-page release list only after two complete snapshots agree', async () => {
    const client = new FakeClient()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    const firstPage = Array.from({length: 100}, (_, index) => ({id: 1000 + index, tag_name: `v9.9.${index}`}))
    client.releasePages = new Map([[1, firstPage], [2, []]])

    // A concurrent deletion earlier in the list shifts the target backward across the
    // page-100 boundary between the two page fetches, so the first complete walk never
    // sees the draft. Acting on that walk would create a second same-tag draft; the
    // agreement requirement retries until two walks match instead.
    client.beforeList = (requestNumber, fake) => {
      if (requestNumber >= 2) fake.releasePages = new Map([[1, [...firstPage.slice(1), matching]], [2, []]])
    }

    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toBe(matching)
    expect(client.calls.filter((call) => call.url.includes('/releases?'))).toHaveLength(6)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('refuses to select or create from a release list that keeps changing', async () => {
    const churn = (operation: (client: FakeClient) => Promise<unknown>) => {
      const client = new FakeClient()
      client.beforeList = (requestNumber, fake) => {
        fake.releases = [{id: 100 + requestNumber, tag_name: `v9.9.${requestNumber}`, assets: []}]
      }
      return {client, result: operation(client)}
    }

    for (const operation of [
      (client: FakeClient) => preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => syncDraft(
          {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => publishDraft(
          {tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})
    ]) {
      const {client, result} = churn(operation)
      await expect(result).rejects.toThrow(/did not repeat one stable complete snapshot/)
      expect(client.calls.filter((call) => call.url.includes('/releases?'))).toHaveLength(4)
      expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
    }
  })

  it('treats a release duplicated across page boundaries as churn instead of ambiguity', async () => {
    const client = new FakeClient()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    // A deletion earlier in the list shifts the target backward across the boundary, so
    // one walk returns the same release ID on both pages. That must never be reported as
    // two conflicting same-tag Releases.
    client.releasePages = new Map([
      [1, [...Array.from({length: 99}, (_, index) => ({id: 1000 + index, tag_name: `v9.9.${index}`})), matching]],
      [2, [matching]]
    ])

    await expect(preflight({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/did not repeat one stable complete snapshot/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('fails preflight, synchronization, and publication on multiple exact-tag candidates before writes', async () => {
    const matching = {
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    const operations = [
      (client: FakeClient) => preflight(
          {tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => syncDraft(
          {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => publishDraft(
          {tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})
    ]

    for (const operation of operations) {
      const client = new FakeClient()
      client.releases = [{id: 7, ...matching}, {id: 8, ...matching}]
      await expect(operation(client)).rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
      expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
      expect(client.calls.some((call) => call.url.startsWith('asset://'))).toBe(false)
    }
  })

  it('rejects a published exact-tag conflict in every release operation before writes', async () => {
    const published = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: false,
      body: '# Candidate\n',
      assets: []
    }
    const operations = [
      (client: FakeClient) => preflight(
          {tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => syncDraft(
          {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client}),
      (client: FakeClient) => publishDraft(
          {tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})
    ]

    for (const operation of operations) {
      const client = new FakeClient()
      client.release = {...published}
      await expect(operation(client)).rejects.toThrow(/already published/)
      expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
    }
  })

  it('detects a post-create duplicate race before uploading an asset', async () => {
    const client = new FakeClient()
    client.afterCreate = (created, fake) => {
      fake.releases.push({...created, id: 8})
    }

    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot
    }, {client})).rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
    expect(client.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`))
      .toEqual(['POST /repos/owner/repo/releases'])
  })

  it('detects a same-tag race after byte checks and before the first asset upload', async () => {
    const client = new FakeClient()
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: []
    }
    client.release = matching
    // Request 3 is the first snapshot of the pre-upload recheck, after the initial
    // agreed discovery and the existing-asset byte checks.
    client.beforeList = (requestNumber, fake) => {
      if (requestNumber === 3) fake.releases.push({...matching, id: 8})
    }

    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot
    }, {client})).rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
    expect(client.calls.some((call) => call.url.startsWith('https://uploads.github.com/'))).toBe(false)
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('rejects a post-create release-ID substitution before uploading an asset', async () => {
    const client = new FakeClient()
    client.afterCreate = (created, fake) => {
      fake.releases = [{...created, id: 8}]
    }

    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot
    }, {client})).rejects.toThrow(/Release ID changed/)
    expect(client.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`))
      .toEqual(['POST /repos/owner/repo/releases'])
  })

  // GitHub's release list is eventually consistent, so a release this process just
  // created can be missing from it. The recorded lag was 2.15s here and over 5s in
  // electron/forge 4325. These record every backoff instead of waiting, so the real
  // bounded schedule is exercised without spending its budget.
  const recordedDelays = () => {
    const delays: number[] = []
    return {delays, sleep: async (milliseconds: number) => { delays.push(milliseconds) }}
  }
  const staleCreate = (client: FakeClient) => {
    let created: Record<string, any> | null = null
    client.afterCreate = (release, fake) => {
      created = release
      // The replica serving the list has not caught up: it returns a complete,
      // self-consistent, and wrong view that omits the release just created.
      fake.releases = []
    }
    return {reveal: () => { client.releases = created ? [created] : [] }}
  }

  it('retries a post-create release list that is stably stale and completes once it catches up', async () => {
    const client = new FakeClient()
    const {delays, sleep} = recordedDelays()
    const {reveal} = staleCreate(client)
    // Two agreeing snapshots per attempt are exactly what the stability guard accepts,
    // so agreement must not be read as absence of a release that provably exists.
    // Replication catches up after the second backoff.
    const listsBeforeCreate = 2
    const staleAttempts = 2
    const boundSleep = async (milliseconds: number) => {
      await sleep(milliseconds)
      if (delays.length === staleAttempts) reveal()
    }

    await syncDraft(
        {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client, sleep: boundSleep})

    expect(delays).toEqual([1000, 2000])
    const listCalls = (calls: Array<{url: string}>) => calls.filter((call) => call.url.includes('/releases?')).length
    const firstUpload = client.calls.findIndex((call) => call.url.startsWith('https://uploads.github.com/'))
    expect(firstUpload).toBeGreaterThan(-1)
    // Two agreeing complete snapshots for the pre-create discovery, two more for each of
    // the three post-create visibility attempts, and two for the pre-upload recheck. No
    // asset is written before the bound release ID is rediscovered and validated.
    expect(listCalls(client.calls.slice(0, firstUpload)))
      .toBe(listsBeforeCreate + (staleAttempts + 1) * 2 + 2)
    const uploads = client.calls.filter((call) => call.url.startsWith('https://uploads.github.com/'))
    expect(uploads).toHaveLength(fs.readdirSync(assets).length)
    expect(uploads.every((call) => call.url.includes('/releases/7/assets'))).toBe(true)
    expect(client.release?.assets.map((asset: ApiAsset) => asset.name).sort()).toEqual(fs.readdirSync(assets).sort())
  })

  it('fails closed without uploading when a created release never becomes visible', async () => {
    const client = new FakeClient()
    const {delays, sleep} = recordedDelays()
    staleCreate(client)

    const failure = await syncDraft(
        {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client, sleep})
        .then(() => null, (reason: Error) => reason)

    expect(failure?.message)
      .toMatch(/^GitHub Release 7 for tag v0\.2\.0-rc\.2 was not visible in the release list after 6 attempts over 23 seconds$/)
    // The release never disappeared; only the list lagged. That wording sent the rc.3
    // triage looking for a deletion, a token-scope defect, and list churn.
    expect(failure?.message).not.toMatch(/disappeared/)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000])
    expect(delays.reduce((total, delay) => total + delay, 0)).toBeGreaterThan(5000)
    expect(client.calls.some((call) => call.url.startsWith('https://uploads.github.com/'))).toBe(false)
    expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('fails a post-create release-ID substitution immediately without consuming a retry', async () => {
    const client = new FakeClient()
    const {delays, sleep} = recordedDelays()
    // The created release provably exists, so a different release carrying the tag means
    // two releases carry it. That is a duplicate, not a lagging replica.
    client.afterCreate = (created, fake) => {
      fake.releases = [{...created, id: 8}]
    }

    await expect(syncDraft(
        {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot}, {client, sleep}))
      .rejects.toThrow(/Release ID changed for exact tag v0\.2\.0-rc\.2; expected 7, found 8/)
    expect(delays).toEqual([])
    expect(client.calls.some((call) => call.url.startsWith('https://uploads.github.com/'))).toBe(false)
  })

  it('keeps multiple exact-tag matches and sustained list churn fatal instead of retryable', async () => {
    const ambiguous = new FakeClient()
    const ambiguousTimer = recordedDelays()
    ambiguous.afterCreate = (created, fake) => {
      fake.releases.push({...created, id: 8})
    }
    await expect(syncDraft(
        {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot},
        {client: ambiguous, sleep: ambiguousTimer.sleep}))
      .rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
    expect(ambiguousTimer.delays).toEqual([])

    const churning = new FakeClient()
    const churnTimer = recordedDelays()
    // Disagreeing snapshots are an unstable list, not a stale one. The visibility retry
    // must never mask that: only the guard's own bounded attempts apply.
    // Request 3 is the first snapshot after the pre-create discovery and the create.
    churning.beforeList = (requestNumber, fake) => {
      if (requestNumber >= 3) fake.releases = [{id: 100 + requestNumber, tag_name: `v9.9.${requestNumber}`, assets: []}]
    }
    await expect(syncDraft(
        {tag, commit, repository: 'owner/repo', assets, sourceRoot: temporaryRoot},
        {client: churning, sleep: churnTimer.sleep}))
      .rejects.toThrow(/did not repeat one stable complete snapshot/)
    expect(churnTimer.delays).toEqual([])

    for (const client of [ambiguous, churning]) {
      expect(client.calls.some((call) => call.url.startsWith('https://uploads.github.com/'))).toBe(false)
      expect(client.calls.some((call) => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
    }
  })

  it('wires the exact workflow environment name through the draft-sync CLI entrypoint', () => {
    const fetchMock = path.join(temporaryRoot, 'mock-github-fetch.cjs')
    writeFile(fetchMock, `
      let release = null
      global.fetch = async (url, options = {}) => {
        const response = (status, body) => ({
          status,
          ok: status >= 200 && status < 300,
          async json() { return body },
          async text() { return JSON.stringify(body) },
          async arrayBuffer() { return Buffer.alloc(0) }
        })
        if (options.method === 'GET' && String(url).includes('/actions/workflows/release-publish.yml/runs')) {
          return response(200, {total_count: 0, workflow_runs: []})
        }
        if (options.method === 'GET' && String(url).includes('/releases?')) {
          return response(200, release ? [release] : [])
        }
        if (options.method === 'POST' && String(url).endsWith('/releases')) {
          release = {id: 7, assets: [], ...JSON.parse(options.body)}
          return response(201, release)
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
      `--assets=${assets}`,
      '--run-id=31067550562'
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

  it('reuses one run provenance and exact bytes when a failed assembly job is rerun', async () => {
    const client = new FakeClient()
    const expectedNames = fs.readdirSync(assets).sort()
    expect(new Set(verifyReleaseSet(assets, tag, commit).targets.map((entry) => entry.workflow.runId)))
      .toEqual(new Set(['123']))
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

  it('does not report an idempotent synchronization success after a duplicate race', async () => {
    const client = new FakeClient()
    const releaseAssets = fs.readdirSync(assets).sort().map((name, index) => {
      const bytes = fs.readFileSync(path.join(assets, name))
      const url = `asset://sync-race-${index}`
      client.bytes.set(url, bytes)
      return {id: 20 + index, name, size: bytes.length, url}
    })
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: releaseAssets
    }
    client.release = matching
    // Every asset already matches, so request 3 is the first snapshot of the final
    // success recheck: a duplicate appearing there must not be reported as success.
    client.beforeList = (requestNumber, fake) => {
      if (requestNumber === 3) fake.releases.push({...matching, id: 8})
    }

    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot
    }, {client})).rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('rejects a fresh dispatch whose run provenance changes partial-draft bytes without writing', async () => {
    const client = new FakeClient()
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      canaryStopAfterUpload: authorizedCanary.stopAfterUploadValue
    }, {client})).rejects.toThrow(/after one successful expected-asset upload/)

    const freshAssets = path.join(temporaryRoot, 'fresh-release')
    assembleReleaseAssets({
      input: createStaging(path.join(temporaryRoot, 'fresh'), '456'),
      output: freshAssets,
      tag,
      commit
    })
    const originalManifest = verifyReleaseSet(assets, tag, commit)
    const freshManifest = verifyReleaseSet(freshAssets, tag, commit)
    expect(new Set(originalManifest.targets.map((entry) => entry.workflow.runId))).toEqual(new Set(['123']))
    expect(new Set(freshManifest.targets.map((entry) => entry.workflow.runId))).toEqual(new Set(['456']))
    expect(hash(fs.readFileSync(path.join(assets, releaseManifestName(version)))))
      .not.toBe(hash(fs.readFileSync(path.join(freshAssets, releaseManifestName(version)))))
    expect(hash(fs.readFileSync(path.join(assets, checksumsName(version)))))
      .not.toBe(hash(fs.readFileSync(path.join(freshAssets, checksumsName(version)))))

    client.calls = []
    await expect(syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets: freshAssets,
      sourceRoot: temporaryRoot
    }, {client})).rejects.toThrow(/bytes differ/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('publishes the one list-visible draft for an exact-head successful push run only', async () => {
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
      id: 123,
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
    expect(client.calls.some((call) => call.url.includes('/releases/tags/'))).toBe(false)
    expect(client.calls.filter((call) => call.method === 'PATCH').map((call) => call.url))
      .toEqual(['/repos/owner/repo/releases/7'])

    client.run = {...client.run, event: 'workflow_dispatch'}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not an allowed tag-push run/)

    client.run = {...client.run, event: 'push', head_sha: 'b'.repeat(40)}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not an allowed tag-push run/)

    client.run = {...client.run, html_url: 'https://github.example/runs/456'}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not an allowed tag-push run/)

    client.run = {...client.run, html_url: 'https://github.example/runs/123', id: 999}
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not an allowed tag-push run/)

    client.run = {...client.run, id: 123, head_sha: commit, html_url: 'https://github.example/runs/123', conclusion: 'failure', status: 'completed', run_attempt: 1}
    client.calls = []
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/no successful attempt/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  // GitHub reports only the latest attempt on the run object, so a later rerun attempt
  // that fails must not poison an otherwise valid draft that an earlier attempt of that
  // same run assembled and that still verifies byte for byte against the manifest.
  it('publishes a draft whose manifest run succeeded on an earlier attempt than the failed latest one', async () => {
    const client = new FakeClient()
    client.release = publishableDraft(client, 'attempt-recovery')
    client.run = {
      id: 123,
      head_sha: commit,
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 3,
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.runAttempts.set(2, {...client.run, run_attempt: 2, conclusion: 'success'})
    client.runAttempts.set(1, {...client.run, run_attempt: 1, conclusion: 'failure'})

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toMatchObject({draft: false, prerelease: true, make_latest: 'false'})
    expect(client.calls.filter((call) => call.method === 'PATCH').map((call) => call.url))
      .toEqual(['/repos/owner/repo/releases/7'])
    // The newest successful attempt settles the run, so no older attempt is consulted.
    expect(client.calls.filter((call) => call.url.includes('/attempts/')).map((call) => call.url))
      .toEqual(['/repos/owner/repo/actions/runs/123/attempts/2'])
  })

  // Accepting an earlier attempt must loosen nothing about which run the assets came from.
  it('still binds publication to the exact run the manifest names, on every attempt', async () => {
    const client = new FakeClient()
    const otherRun = path.join(temporaryRoot, 'other-run')
    assembleReleaseAssets({input: createStaging(path.join(temporaryRoot, 'other'), '456'), output: otherRun, tag, commit})
    client.release = publishableDraft(client, 'attempt-other-run', otherRun)
    client.run = {
      id: 123,
      head_sha: commit,
      status: 'completed',
      conclusion: 'success',
      run_attempt: 2,
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.runAttempts.set(1, {...client.run, run_attempt: 1, conclusion: 'success'})

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/not an allowed tag-push run/)
    expect(client.calls.filter((call) => call.url.includes('/actions/runs/')).map((call) => call.url))
      .toEqual(['/repos/owner/repo/actions/runs/456'])
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('refuses a manifest run that never succeeded on any attempt', async () => {
    const client = new FakeClient()
    client.release = publishableDraft(client, 'attempt-never')
    client.run = {
      id: 123,
      head_sha: commit,
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 3,
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.runAttempts.set(2, {...client.run, run_attempt: 2, conclusion: 'cancelled'})
    client.runAttempts.set(1, {...client.run, run_attempt: 1, conclusion: 'failure'})

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/no successful attempt/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('never treats an earlier attempt as success while the manifest run is still active', async () => {
    const client = new FakeClient()
    client.release = publishableDraft(client, 'attempt-active')
    client.run = {
      id: 123,
      head_sha: commit,
      status: 'in_progress',
      conclusion: null,
      run_attempt: 2,
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.runAttempts.set(1, {...client.run, run_attempt: 1, status: 'completed', conclusion: 'success'})

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/has not completed/)
    expect(client.calls.some((call) => call.url.includes('/attempts/'))).toBe(false)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it.each([
    ['an unreadable attempt record', 2, null],
    ['an attempt of a different run', 2, {id: 999}],
    ['an attempt for a different commit', 2, {head_sha: 'b'.repeat(40)}],
    ['an attempt from a different workflow', 2, {path: '.github/workflows/release-publish.yml'}],
    ['an attempt whose number does not match', 2, {run_attempt: 5}]
  ])('fails closed on %s rather than publishing', async (_label, number, overrides) => {
    const client = new FakeClient()
    client.release = publishableDraft(client, `attempt-malformed-${number}-${_label.replace(/\W+/g, '-')}`)
    client.run = {
      id: 123,
      head_sha: commit,
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 3,
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.runAttempts.set(number, overrides && {...client.run, run_attempt: number, conclusion: 'success', ...overrides})
    client.runAttempts.set(1, {...client.run, run_attempt: 1, conclusion: 'success'})

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/is missing or does not describe that exact run/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('fails closed when the manifest run reports no usable attempt number or hides an attempt', async () => {
    const client = new FakeClient()
    client.release = publishableDraft(client, 'attempt-unusable')
    const base = {
      id: 123,
      head_sha: commit,
      status: 'completed',
      conclusion: 'failure',
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }

    for (const run_attempt of [undefined, 0, '2', 2.5]) {
      client.run = {...base, run_attempt}
      await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
        .rejects.toThrow(/usable attempt number/)
    }

    // A 404 on a claimed attempt propagates instead of being read as "no earlier failure".
    client.run = {...base, run_attempt: 3}
    client.runAttempts.set(1, {...base, run_attempt: 1, conclusion: 'success'})
    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/attempts\/2 failed \(404\)/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('ignores asynchronous GitHub digest enrichment after verifying exact asset bytes', async () => {
    const client = new FakeClient()
    const releaseAssets = fs.readdirSync(assets).sort().map((name, index) => {
      const bytes = fs.readFileSync(path.join(assets, name))
      const url = `asset://publish-digest-${index}`
      client.bytes.set(url, bytes)
      return {id: 20 + index, name, size: bytes.length, url, digest: null}
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
      id: 123,
      head_sha: commit,
      conclusion: 'success',
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    client.beforeList = (requestNumber, fake) => {
      if (requestNumber === 3) {
        for (const asset of fake.releases[0].assets) asset.digest = `sha256:${'a'.repeat(64)}`
      }
    }

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .resolves.toMatchObject({draft: false, prerelease: true, make_latest: 'false'})
    expect(client.calls.filter((call) => call.method === 'PATCH').map((call) => call.url))
      .toEqual(['/repos/owner/repo/releases/7'])
  })

  it('rechecks uniqueness after publication verification and never publishes a raced duplicate', async () => {
    const client = new FakeClient()
    const releaseAssets = fs.readdirSync(assets).sort().map((name, index) => {
      const bytes = fs.readFileSync(path.join(assets, name))
      const url = `asset://publish-race-${index}`
      client.bytes.set(url, bytes)
      return {id: 20 + index, name, size: bytes.length, url}
    })
    const matching = {
      id: 7,
      tag_name: tag,
      name: tag,
      target_commitish: commit,
      prerelease: true,
      draft: true,
      body: '# Candidate\n',
      assets: releaseAssets
    }
    client.release = matching
    client.run = {
      id: 123,
      head_sha: commit,
      conclusion: 'success',
      event: 'push',
      path: '.github/workflows/release-prepare.yml',
      html_url: 'https://github.example/runs/123'
    }
    // Request 3 is the first snapshot of the post-verification recheck.
    client.beforeList = (requestNumber, fake) => {
      if (requestNumber === 3) fake.releases.push({...matching, id: 8})
    }

    await expect(publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client}))
      .rejects.toThrow(/Multiple GitHub Releases exist for exact tag/)
    expect(client.calls.some((call) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
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

describe('bidirectional active-run refusal between preparation and publication', () => {
  const preparePath = '.github/workflows/release-prepare.yml'
  const publishPath = '.github/workflows/release-publish.yml'
  // GitHub's workflow-run status enum has grown over time, so the guard tests
  // terminality as `completed` rather than matching an allowlist of active states. Each
  // of these must refuse on its own, not merely one representative value.
  const nonTerminalStatuses = ['queued', 'in_progress', 'waiting', 'pending', 'requested']
  let temporaryRoot: string
  let assets: string

  const wrote = (client: FakeClient) =>
    client.calls.some((call) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method))
  const downloaded = (client: FakeClient) => client.calls.some((call) => call.url.startsWith('asset://'))
  const patched = (client: FakeClient) => client.calls.filter((call) => call.method === 'PATCH').map((call) => call.url)
  const run = (values: Record<string, unknown> = {}) =>
    ({id: 31067550562, head_branch: tag, path: preparePath, status: 'completed', ...values})

  function publishableClient() {
    const client = new FakeClient()
    const releaseAssets = fs.readdirSync(assets).sort().map((name, index) => {
      const bytes = fs.readFileSync(path.join(assets, name))
      const url = `asset://active-run-${index}`
      client.bytes.set(url, bytes)
      return {id: 20 + index, name, size: bytes.length, url}
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
      path: preparePath,
      html_url: 'https://github.example/runs/123'
    }
    return client
  }

  const publish = (client: FakeClient) =>
    publishDraft({tag, commit, repository: 'owner/repo', sourceRoot: temporaryRoot}, {client})

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-release-active-run-'))
    assets = path.join(temporaryRoot, 'release')
    assembleReleaseAssets({input: createStaging(temporaryRoot), output: assets, tag, commit})
    writeFile(path.join(temporaryRoot, 'docs', 'releases', `${tag}.md`), '# Candidate\n')
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  it('refuses to publish while a preparation run for the exact tag is still running', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [run({status: 'in_progress'})])

    await expect(publish(client))
      .rejects.toThrow(/Refusing to act on v0\.2\.0-rc\.2 while release-prepare\.yml run 31067550562 \(in_progress\) is not terminal/)
    // The rerun this refuses against is mutating the asset set publication would verify,
    // so nothing may be written and nothing may even be downloaded for comparison.
    expect(wrote(client)).toBe(false)
    expect(downloaded(client)).toBe(false)
    expect(client.calls.filter((call) => call.url.includes('/releases?'))).toHaveLength(0)
  })

  it.each(nonTerminalStatuses)('refuses to publish on the non-terminal preparation status %s', async (status) => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [run({status})])

    await expect(publish(client)).rejects.toThrow(new RegExp(`31067550562 \\(${status}\\) is not terminal`))
    expect(wrote(client)).toBe(false)
  })

  it('names every non-terminal preparation run rather than only the first', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [
      run({id: 1, status: 'in_progress'}),
      run({id: 2, status: 'completed'}),
      run({id: 3, status: 'waiting'})
    ])

    await expect(publish(client))
      .rejects.toThrow(/release-prepare\.yml runs 1 \(in_progress\), 3 \(waiting\) are not terminal/)
    expect(wrote(client)).toBe(false)
  })

  it('publishes when every preparation run for the tag has reached a terminal status', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [run({status: 'completed'})])

    await expect(publish(client)).resolves.toMatchObject({draft: false, prerelease: true, make_latest: 'false'})
    expect(patched(client)).toEqual(['/repos/owner/repo/releases/7'])
  })

  it('ignores a running preparation run for a different tag', async () => {
    const client = publishableClient()
    // Exact head_branch equality, not a prefix test: rc.20 is a different candidate.
    client.workflowRuns.set('release-prepare.yml', [run({head_branch: `${tag}0`, status: 'in_progress'})])

    await expect(publish(client)).resolves.toMatchObject({draft: false})
    expect(patched(client)).toEqual(['/repos/owner/repo/releases/7'])
  })

  it('ignores a running run of another workflow at the same tag', async () => {
    const client = publishableClient()
    // Exact workflow-path identity, not a prefix test: a neighbouring path that merely
    // starts with the preparation workflow file is a different workflow.
    client.workflowRuns.set('release-prepare.yml', [
      run({id: 41, path: publishPath, status: 'in_progress'}),
      run({id: 42, path: `${preparePath}.disabled`, status: 'in_progress'}),
      run({id: 43, path: '.github/workflows/pull-request.yml', status: 'in_progress'})
    ])

    await expect(publish(client)).resolves.toMatchObject({draft: false})
    expect(patched(client)).toEqual(['/repos/owner/repo/releases/7'])
  })

  it('accepts a preparation run reported in the called-workflow reference form', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [run({path: `${preparePath}@refs/tags/${tag}`, status: 'queued'})])

    await expect(publish(client)).rejects.toThrow(/31067550562 \(queued\) is not terminal/)
    expect(wrote(client)).toBe(false)
  })

  it('rechecks immediately before the publication write and refuses a rerun started meanwhile', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [run({status: 'completed'})])
    // The first listing is the pre-verification check; verification takes long enough for
    // an operator to start a rerun, so the second listing is the one that must catch it.
    client.beforeWorkflowRuns = (requestNumber, fake) => {
      if (requestNumber === 2) fake.workflowRuns.set('release-prepare.yml', [run({status: 'in_progress'})])
    }

    await expect(publish(client)).rejects.toThrow(/31067550562 \(in_progress\) is not terminal/)
    expect(client.workflowRunRequests).toBe(2)
    expect(patched(client)).toEqual([])
    expect(wrote(client)).toBe(false)
  })

  it('reads every page of the workflow run list before deciding nothing is active', async () => {
    const client = publishableClient()
    client.workflowRuns.set('release-prepare.yml', [
      ...Array.from({length: 100}, (_, index) => run({id: 1000 + index, head_branch: `v9.9.${index}`})),
      run({status: 'in_progress'})
    ])

    await expect(publish(client)).rejects.toThrow(/31067550562 \(in_progress\) is not terminal/)
    expect(client.calls.filter((call) => call.url.includes('/actions/workflows/')).map((call) => call.url)).toEqual([
      '/repos/owner/repo/actions/workflows/release-prepare.yml/runs?per_page=100&page=1',
      '/repos/owner/repo/actions/workflows/release-prepare.yml/runs?per_page=100&page=2'
    ])
    expect(wrote(client)).toBe(false)
  })

  it('refuses to assemble a draft while a publication run for the exact tag is not terminal', async () => {
    for (const status of nonTerminalStatuses) {
      const client = new FakeClient()
      client.workflowRuns.set('release-publish.yml', [run({id: 31076244826, path: publishPath, status})])

      await expect(syncDraft({
        tag,
        commit,
        repository: 'owner/repo',
        assets,
        sourceRoot: temporaryRoot,
        runId: '31067550562'
      }, {client})).rejects.toThrow(new RegExp(`release-publish\\.yml run 31076244826 \\(${status}\\) is not terminal`))
      // A publication awaiting environment approval is exactly the case this protects, so
      // no create, no upload, and no other write may happen first.
      expect(wrote(client)).toBe(false)
      expect(client.calls.some((call) => call.url.startsWith('https://uploads.github.com/'))).toBe(false)
      expect(client.calls.filter((call) => call.url.includes('/releases?'))).toHaveLength(0)
    }
  })

  it('never refuses draft assembly against the run issuing the check', async () => {
    const client = new FakeClient()
    client.workflowRuns.set('release-publish.yml', [
      run({id: 31067550562, path: publishPath, status: 'in_progress'}),
      run({id: 31076244826, path: publishPath, status: 'completed'})
    ])

    await syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      runId: 31067550562
    }, {client})
    expect(client.release?.assets.map((asset: ApiAsset) => asset.name).sort()).toEqual(fs.readdirSync(assets).sort())
  })

  it('assembles a draft when the only publication run for the tag is terminal', async () => {
    const client = new FakeClient()
    client.workflowRuns.set('release-publish.yml', [
      run({id: 31076244826, path: publishPath, status: 'completed'}),
      run({id: 31076244827, path: publishPath, head_branch: `${tag}0`, status: 'in_progress'})
    ])

    await syncDraft({
      tag,
      commit,
      repository: 'owner/repo',
      assets,
      sourceRoot: temporaryRoot,
      runId: '31067550562'
    }, {client})
    expect(client.release?.assets.map((asset: ApiAsset) => asset.name).sort()).toEqual(fs.readdirSync(assets).sort())
    expect(client.calls.filter((call) => call.url.includes('/actions/workflows/')).map((call) => call.url))
      .toEqual(['/repos/owner/repo/actions/workflows/release-publish.yml/runs?per_page=100&page=1'])
  })

  it('requires the caller run identity for draft synchronization and rejects it elsewhere', () => {
    const cli = (args: string[]) => spawnSync(process.execPath, [
      path.join(process.cwd(), 'scripts', 'release-github.cjs'),
      ...args
    ], {cwd: temporaryRoot, encoding: 'utf8', env: {...process.env, GITHUB_TOKEN: 'test-token'}})
    const identity = [`--tag=${tag}`, `--commit=${commit}`, '--repository=owner/repo']

    for (const args of [
      ['sync-draft', ...identity, `--assets=${assets}`],
      ['publish', ...identity, '--run-id=1'],
      ['preflight', ...identity, '--run-id=1']
    ]) {
      const result = cli(args)
      expect(result.status, args.join(' ')).toBe(2)
      expect(result.stderr, args.join(' ')).toMatch(/^Usage: release:github/)
    }
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
