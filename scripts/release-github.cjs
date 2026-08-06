'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {parseReleaseTag} = require('./release-identity.cjs')
const {
  checksumsName,
  releaseArchiveName,
  releaseManifestName,
  releaseNotesPath,
  releaseTargets,
  sha256
} = require('./release-config.cjs')
const {verifyReleaseSet} = require('./release-assets.cjs')
const {partialDraftCanaryEnabled} = require('./release-canary.cjs')
const {root} = require('./package-config.cjs')

function repositoryParts(repository) {
  const match = String(repository || '').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) throw new Error('Repository must be an owner/name pair')
  return {owner: match[1], repo: match[2]}
}

function githubClient(token = process.env.GITHUB_TOKEN, fetchImpl = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN is required')
  async function request(method, url, options = {}) {
    const response = await fetchImpl(url.startsWith('http') ? url : `https://api.github.com${url}`, {
      method,
      headers: {
        Accept: options.accept || 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.contentType ? {'Content-Type': options.contentType} : {})
      },
      body: options.body === undefined
        ? undefined
        : Buffer.isBuffer(options.body) ? options.body : JSON.stringify(options.body),
      redirect: 'follow'
    })
    if (options.allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${await response.text()}`)
    if (options.raw) return Buffer.from(await response.arrayBuffer())
    if (response.status === 204) return null
    return response.json()
  }
  return {request}
}

function assertReleaseIdentity(release, identity, expectedBody) {
  // GitHub may report the default branch in target_commitish when a release uses an
  // already-existing tag, even if creation supplied the dereferenced commit. The
  // immutable local tag/checkout gate establishes commit identity; release identity
  // here is the exact tag, name, and channel.
  if (release.tag_name !== identity.tag || release.name !== identity.tag ||
      release.prerelease !== identity.prerelease) {
    throw new Error('Existing GitHub Release identity conflicts with tag, name, or channel')
  }
  if (!release.draft) throw new Error('Existing GitHub Release is already published and cannot be changed')
  if (expectedBody !== undefined && release.body !== expectedBody) {
    throw new Error('Existing draft release notes differ from the committed release notes')
  }
}

function releaseId(release) {
  if (!Number.isSafeInteger(release?.id) || release.id <= 0) throw new Error('GitHub Release has an invalid ID')
  return release.id
}

const releaseListPageSize = 100
const releaseListSnapshotAttempts = 4

async function releaseListSnapshot(client, owner, repo) {
  const releases = []
  for (let page = 1; ; page += 1) {
    const batch = await client.request(
        'GET', `/repos/${owner}/${repo}/releases?per_page=${releaseListPageSize}&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub release list response is not an array')
    releases.push(...batch)
    if (batch.length < releaseListPageSize) break
  }
  return releases
}

// Offset pagination over the release list is not atomic. A release created or deleted
// between page fetches shifts the page boundary, so a single complete walk can return
// one release twice or skip it entirely. Duplicating it fabricates an ambiguous
// identity; skipping it lets synchronization create a second same-tag draft, which is
// exactly the duplicate-draft class this discovery path exists to close. Require two
// consecutive complete snapshots that agree on the same ordered, duplicate-free release
// IDs before any caller may act on the list, and refuse to act under sustained churn
// rather than proceeding on an unstable list.
async function listReleases(client, repository) {
  const {owner, repo} = repositoryParts(repository)
  let previousKey = null
  for (let attempt = 0; attempt < releaseListSnapshotAttempts; attempt += 1) {
    const releases = await releaseListSnapshot(client, owner, repo)
    const ids = releases.map((release) => releaseId(release))
    const key = new Set(ids).size === ids.length ? ids.join(',') : null
    if (key !== null && key === previousKey) return releases
    previousKey = key
  }
  throw new Error('GitHub release list did not repeat one stable complete snapshot; refusing to act on a changing release list')
}

async function findRelease(client, repository, tag) {
  const matches = (await listReleases(client, repository)).filter((release) => release.tag_name === tag)
  if (matches.length > 1) {
    throw new Error(`Multiple GitHub Releases exist for exact tag ${tag}: ${matches.map((release) => release.id).join(', ')}`)
  }
  return matches[0] || null
}

// GitHub's release list is eventually consistent and its lag is undocumented. Every
// caller here already holds a release ID it created or already discovered, so the list
// cannot report that release out of existence: absence only means the replica served has
// not caught up yet. The stability guard above cannot see that, because two reads of the
// same stale replica agree with each other. Retry the discovery, never the create, until
// the bound ID appears. Observed lag was 2.15s here and over 5s upstream, so six attempts
// spanning a 23-second budget clear both measurements and stay far inside the assembly
// job's ten-minute timeout. Every other outcome stays fail-closed and unretried: a
// different exact-tag release ID means a genuine duplicate, because the bound release
// provably exists; multiple exact-tag matches already failed in findRelease; sustained
// list churn already failed in listReleases; and exhaustion refuses to proceed rather
// than upload without ever having proved uniqueness.
const boundReleaseVisibilityDelaysMs = [1000, 2000, 4000, 8000, 8000]

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function findBoundRelease(client, repository, tag, expectedId, operations = {}) {
  const wait = operations.sleep || sleep
  for (let attempt = 0; ; attempt += 1) {
    const release = await findRelease(client, repository, tag)
    if (release) {
      if (releaseId(release) !== expectedId) {
        throw new Error(`GitHub Release ID changed for exact tag ${tag}; expected ${expectedId}, found ${release.id}`)
      }
      return release
    }
    if (attempt >= boundReleaseVisibilityDelaysMs.length) {
      const attempts = boundReleaseVisibilityDelaysMs.length + 1
      const seconds = boundReleaseVisibilityDelaysMs.reduce((total, delay) => total + delay, 0) / 1000
      throw new Error(
          `GitHub Release ${expectedId} for tag ${tag} was not visible in the release list after ${attempts} attempts over ${seconds} seconds`)
    }
    await wait(boundReleaseVisibilityDelaysMs[attempt])
  }
}

async function preflight(options, operations = {}) {
  const parsed = parseReleaseTag(options.tag)
  const identity = {
    tag: parsed.tag,
    commit: options.commit,
    prerelease: parsed.prerelease !== null
  }
  if (!/^[0-9a-f]{40}$/.test(identity.commit || '')) throw new Error('Release commit must be a full lowercase Git SHA')
  const client = operations.client || githubClient()
  const release = await findRelease(client, options.repository, identity.tag)
  if (release) {
    const notes = fs.readFileSync(releaseNotesPath(identity.tag, options.sourceRoot || root), 'utf8')
    assertReleaseIdentity(release, identity, notes)
    const expectedNames = [
      ...releaseTargets.filter((target) => target.public)
          .map((target) => releaseArchiveName(parsed.version, target)),
      releaseManifestName(parsed.version),
      checksumsName(parsed.version)
    ]
    const existingAssets = mapAssets(release.assets)
    const extras = [...existingAssets.keys()].filter((name) => !expectedNames.includes(name))
    if (extras.length > 0) throw new Error(`Draft release has unexpected assets: ${extras.join(', ')}`)
  }
  return release
}

async function downloadAsset(client, asset) {
  return client.request('GET', asset.url, {
    accept: 'application/octet-stream',
    raw: true
  })
}

function mapAssets(assets) {
  const mapped = new Map()
  for (const asset of assets || []) {
    if (mapped.has(asset.name)) throw new Error(`Draft release has duplicate assets: ${asset.name}`)
    mapped.set(asset.name, asset)
  }
  return mapped
}

async function validateDraftAssets(client, release, expectedFiles, assetsDirectory) {
  const existing = mapAssets(release.assets)
  const extras = [...existing.keys()].filter((name) => !expectedFiles.includes(name))
  if (extras.length > 0) throw new Error(`Draft release has unexpected assets: ${extras.join(', ')}`)

  // Validate every existing expected asset before writing any missing asset. This
  // keeps mismatches and extras fail-only even during bounded partial-draft recovery.
  for (const basename of expectedFiles) {
    const asset = existing.get(basename)
    if (!asset) continue
    const localPath = path.join(assetsDirectory, basename)
    if (asset.size !== fs.statSync(localPath).size) throw new Error(`Existing draft asset size differs: ${basename}`)
    const bytes = await downloadAsset(client, asset)
    const temporary = path.join(os.tmpdir(), `electris-existing-${process.pid}-${basename}`)
    try {
      fs.writeFileSync(temporary, bytes)
      if (sha256(temporary) !== sha256(localPath)) throw new Error(`Existing draft asset bytes differ: ${basename}`)
    } finally {
      fs.rmSync(temporary, {force: true})
    }
  }
  return existing
}

async function syncDraft(options, operations = {}) {
  const parsed = parseReleaseTag(options.tag)
  const identity = {
    tag: parsed.tag,
    commit: options.commit,
    prerelease: parsed.prerelease !== null
  }
  const sourceRoot = options.sourceRoot || root
  verifyReleaseSet(options.assets, identity.tag, identity.commit)
  const notes = fs.readFileSync(releaseNotesPath(identity.tag, sourceRoot), 'utf8')
  const client = operations.client || githubClient()
  const {owner, repo} = repositoryParts(options.repository)
  let release = await findRelease(client, options.repository, identity.tag)
  if (!release) {
    const created = await client.request('POST', `/repos/${owner}/${repo}/releases`, {body: {
      tag_name: identity.tag,
      target_commitish: identity.commit,
      name: identity.tag,
      body: notes,
      draft: true,
      prerelease: identity.prerelease,
      generate_release_notes: false
    }})
    assertReleaseIdentity(created, identity, notes)
    const createdId = releaseId(created)
    // GitHub does not make create-by-tag atomic. Re-list drafts and published
    // releases before uploading so a concurrent same-tag create fails closed. The
    // create response already proved this release exists, so a list that omits it is
    // stale rather than authoritative and is retried inside findBoundRelease.
    release = await findBoundRelease(client, options.repository, identity.tag, createdId, operations)
  }
  assertReleaseIdentity(release, identity, notes)
  const boundId = releaseId(release)

  const expectedFiles = fs.readdirSync(options.assets, {withFileTypes: true})
      .filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  let existing = await validateDraftAssets(client, release, expectedFiles, options.assets)
  let missing = expectedFiles.filter((name) => !existing.has(name))

  if (missing.length > 0) {
    // Reassert both exact-tag uniqueness and the bound release ID immediately
    // before asset mutation, then repeat all byte/extras checks on that object.
    release = await findBoundRelease(client, options.repository, identity.tag, boundId, operations)
    assertReleaseIdentity(release, identity, notes)
    existing = await validateDraftAssets(client, release, expectedFiles, options.assets)
    missing = expectedFiles.filter((name) => !existing.has(name))
  }

  const stopAfterOneUpload = partialDraftCanaryEnabled(options.canaryStopAfterUpload, identity.tag)
  let uploads = 0
  for (const basename of missing) {
    const localPath = path.join(options.assets, basename)
    const encodedName = encodeURIComponent(basename)
    await client.request('POST', `https://uploads.github.com/repos/${owner}/${repo}/releases/${boundId}/assets?name=${encodedName}`, {
      body: fs.readFileSync(localPath),
      contentType: 'application/octet-stream'
    })
    uploads += 1
    if (stopAfterOneUpload && uploads === 1) {
      throw new Error(`Authorized temporary release canary stopped ${identity.tag} after one successful expected-asset upload`)
    }
  }

  // Never report synchronization success if a same-tag release appeared while
  // bytes were being checked or uploaded.
  const current = await findBoundRelease(client, options.repository, identity.tag, boundId, operations)
  assertReleaseIdentity(current, identity, notes)
  return current
}

function publicationUpdate(tag) {
  const parsed = parseReleaseTag(tag)
  const prerelease = parsed.prerelease !== null
  return {
    draft: false,
    prerelease,
    make_latest: prerelease ? 'false' : 'true'
  }
}

async function publishDraft(options, operations = {}) {
  const parsed = parseReleaseTag(options.tag)
  const identity = {
    tag: parsed.tag,
    commit: options.commit,
    prerelease: parsed.prerelease !== null
  }
  const client = operations.client || githubClient()
  const {owner, repo} = repositoryParts(options.repository)
  const release = await findRelease(client, options.repository, identity.tag)
  if (!release) throw new Error(`Draft release does not exist: ${identity.tag}`)
  const notes = fs.readFileSync(releaseNotesPath(identity.tag, options.sourceRoot || root), 'utf8')
  assertReleaseIdentity(release, identity, notes)
  const boundId = releaseId(release)
  const verifiedAssetInventory = JSON.stringify([...mapAssets(release.assets).values()]
      .map(({id, name, size, url}) => ({id, name, size, url}))
      .sort((left, right) => left.name.localeCompare(right.name)))
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-publish-verify-'))
  try {
    const releaseAssets = mapAssets(release.assets)
    for (const asset of releaseAssets.values()) {
      if (path.basename(asset.name) !== asset.name) throw new Error(`Unsafe release asset name: ${asset.name}`)
      fs.writeFileSync(path.join(temporary, asset.name), await downloadAsset(client, asset))
    }
    const manifest = verifyReleaseSet(temporary, identity.tag, identity.commit)
    const runIds = new Set(manifest.targets.map((entry) => entry.workflow.runId))
    const runUrls = new Set(manifest.targets.map((entry) => entry.workflow.runUrl))
    if (runIds.size !== 1 || runUrls.size !== 1) throw new Error('Release manifest does not identify one prepare run')
    const runId = [...runIds][0]
    const run = await client.request('GET', `/repos/${owner}/${repo}/actions/runs/${runId}`)
    if (!run || run.head_sha !== identity.commit || run.conclusion !== 'success' ||
        run.event !== 'push' ||
        !String(run.path || '').startsWith('.github/workflows/release-prepare.yml') ||
        run.html_url !== [...runUrls][0]) {
      throw new Error('Release manifest prepare run is not a successful allowed run for this exact commit')
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true})
  }

  const current = await findBoundRelease(client, options.repository, identity.tag, boundId, operations)
  assertReleaseIdentity(current, identity, notes)
  const currentAssetInventory = JSON.stringify([...mapAssets(current.assets).values()]
      .map(({id, name, size, url}) => ({id, name, size, url}))
      .sort((left, right) => left.name.localeCompare(right.name)))
  if (currentAssetInventory !== verifiedAssetInventory) {
    throw new Error('Draft release assets changed during publication verification')
  }
  return client.request('PATCH', `/repos/${owner}/${repo}/releases/${boundId}`, {
    body: publicationUpdate(identity.tag)
  })
}

function parseOptions(args) {
  const [command, ...rest] = args
  if (!['preflight', 'sync-draft', 'publish'].includes(command)) return null
  const values = {}
  for (const argument of rest) {
    const match = argument.match(/^--(tag|commit|repository|assets)=(.*)$/)
    if (!match || !match[2] || Object.hasOwn(values, match[1])) return null
    values[match[1]] = match[2]
  }
  if (!values.tag || !values.commit || !values.repository) return null
  if (command === 'sync-draft' && !values.assets) return null
  if (command !== 'sync-draft' && values.assets) return null
  return {command, ...values}
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options) {
    console.error('Usage: release:github -- <preflight|sync-draft|publish> --tag=<tag> --commit=<sha> --repository=<owner/name> [--assets=<dir>]')
    process.exitCode = 2
    return
  }
  try {
    if (options.command === 'preflight') await preflight(options)
    if (options.command === 'sync-draft') {
      await syncDraft({...options, canaryStopAfterUpload: process.env.ELECTRIS_CANARY_STOP_AFTER_UPLOAD})
    }
    if (options.command === 'publish') await publishDraft(options)
    console.log(`GitHub release ${options.command} passed for ${options.tag}`)
  } catch (error) {
    console.error(`GitHub release ${options.command} failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()

module.exports = {
  assertReleaseIdentity,
  findRelease,
  githubClient,
  preflight,
  publicationUpdate,
  publishDraft,
  repositoryParts,
  syncDraft
}
