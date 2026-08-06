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

const preparePath = '.github/workflows/release-prepare.yml'
const publishPath = '.github/workflows/release-publish.yml'

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

const workflowRunListPageSize = 100
// A full page means more runs exist, so pagination continues. The cap only bounds a
// pathological list; ten full pages is a thousand runs of one release workflow, far
// beyond anything this repository can accumulate, and exceeding it refuses rather than
// acting on a list that was never completely read.
const workflowRunListPageLimit = 10

async function listWorkflowRuns(client, repository, workflowFile) {
  const {owner, repo} = repositoryParts(repository)
  const runs = []
  for (let page = 1; ; page += 1) {
    const response = await client.request(
        'GET',
        `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?per_page=${workflowRunListPageSize}&page=${page}`)
    const batch = response?.workflow_runs
    if (!Array.isArray(batch)) throw new Error(`GitHub workflow run list for ${workflowFile} is not an array`)
    runs.push(...batch)
    if (batch.length < workflowRunListPageSize) return runs
    if (page >= workflowRunListPageLimit) {
      throw new Error(
          `GitHub workflow run list for ${workflowFile} exceeded ${workflowRunListPageLimit} pages; refusing to act on an incompletely read list`)
    }
  }
}

// GitHub reports a called reusable workflow as `<path>@<ref>`. Every other run reports
// the file path itself, so require equality or that exact suffix form: a prefix test
// would also accept a neighbouring path such as `<path>.disabled`, which is a different
// workflow and must never be read as this one.
function runUsesWorkflow(run, workflowPath) {
  const runPath = String(run?.path || '')
  return runPath === workflowPath || runPath.startsWith(`${workflowPath}@`)
}

// The two release workflows carry distinct repository-wide concurrency groups, so GitHub
// never serializes preparation against publication for one tag. Neither side may queue
// behind the other either: an unapproved publication holds its slot for up to 30 days
// while the target artifacts a preparation rerun needs expire at 14, so a shared group
// would starve the same-run recovery contract instead of protecting it. Each side
// therefore refuses, loudly and immediately, while any run of the other workflow for the
// exact tag is non-terminal. This narrows the window to the interval before the next
// write plus workflow-run list staleness; it does not close it mechanically.
//
// Terminality is `status === 'completed'` rather than an allowlist of active statuses.
// GitHub's run-status enum has grown over time (`waiting`, `pending`, and `requested`
// arrived after the original set), so an allowlist would silently fail open the next
// time it grows, and a response missing a status fails closed here instead.
async function assertNoActiveRun(client, options) {
  const {repository, workflowPath, tag} = options
  const workflowFile = workflowPath.split('/').pop()
  const excludeRunId = options.excludeRunId === undefined || options.excludeRunId === null
    ? null
    : String(options.excludeRunId)
  const active = (await listWorkflowRuns(client, repository, workflowFile)).filter((run) =>
    run.head_branch === tag && runUsesWorkflow(run, workflowPath) && run.status !== 'completed' &&
      (excludeRunId === null || String(run.id) !== excludeRunId))
  if (active.length > 0) {
    const described = active.map((run) => `${run.id} (${run.status})`).join(', ')
    throw new Error(
        `Refusing to act on ${tag} while ${workflowFile} ${active.length === 1 ? 'run' : 'runs'} ${described} ${active.length === 1 ? 'is' : 'are'} not terminal`)
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
  // Refuse before discovery, so a live publication for this tag stops assembly ahead of
  // any create, upload, or other write. Publication has priority: a refused assembly is
  // fully recoverable by rerunning this same run, while a cancelled or superseded
  // publication is not recoverable without fresh authorization. The caller's own run ID
  // is excluded so no future refactor can make this guard reject itself.
  //
  // A publication run reports its dispatch ref as head_branch, so this sees one
  // dispatched from the tag. A dispatch from any other ref is not a publication this
  // needs to see: the release-publish environment's `v*` deployment-tag policy keeps it
  // out of the environment, so its job never starts and it can never write.
  await assertNoActiveRun(client, {
    repository: options.repository,
    workflowPath: publishPath,
    tag: identity.tag,
    excludeRunId: options.runId
  })
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

function isAllowedPrepareRun(run, runId, commit, runUrl) {
  return Boolean(run) && String(run.id) === String(runId) && run.head_sha === commit &&
      run.event === 'push' && runUsesWorkflow(run, preparePath) &&
      run.html_url === runUrl
}

// GitHub's workflow-run object reports the latest attempt, so `conclusion` belongs to
// whichever attempt ran last rather than to the attempt that assembled the draft. The
// documented recovery path deliberately reruns the same run, so one later attempt
// failing after an earlier one succeeded would otherwise make a complete, byte-verified
// draft permanently unpublishable and force a new version and tag. Publication needs one
// attempt of the manifest's exact run to have succeeded, not the last one: the draft's
// bytes are already proven against the manifest for this exact tag and commit, and
// synchronization only ever adds a missing asset and refuses differing bytes, so a later
// attempt cannot change what a successful earlier attempt uploaded. Accept success on any
// attempt of that one run while keeping every run-identity check exactly as strict, and
// fail closed whenever an attempt record is missing, unreadable, or inconsistent.
async function assertSuccessfulPrepareAttempt(client, owner, repo, runId, run, commit, runUrl) {
  // Callers gate on isAllowedPrepareRun first, so `run` already is the manifest's run.
  if (run.conclusion === 'success') return
  // Earlier attempts only settle a run that has stopped. While an attempt is still
  // active the run may yet write to the draft, so publication keeps refusing.
  if (run.status !== 'completed') {
    throw new Error('Release manifest prepare run has not completed and cannot be published against')
  }
  const latest = run.run_attempt
  if (!Number.isSafeInteger(latest) || latest < 1) {
    throw new Error('Release manifest prepare run does not report a usable attempt number')
  }
  for (let number = latest - 1; number >= 1; number -= 1) {
    const attempt = await client.request('GET', `/repos/${owner}/${repo}/actions/runs/${runId}/attempts/${number}`)
    if (!attempt || attempt.run_attempt !== number ||
        !isAllowedPrepareRun(attempt, runId, commit, runUrl)) {
      throw new Error(`Release manifest prepare run attempt ${number} is missing or does not describe that exact run`)
    }
    if (attempt.conclusion === 'success') return
  }
  throw new Error('Release manifest prepare run has no successful attempt for this exact commit')
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
  // Fail fast before any verification work: a preparation rerun for this tag can still be
  // mutating the very asset set this run is about to download and compare.
  await assertNoActiveRun(client, {
    repository: options.repository,
    workflowPath: preparePath,
    tag: identity.tag
  })
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
    const runUrl = [...runUrls][0]
    const run = await client.request('GET', `/repos/${owner}/${repo}/actions/runs/${runId}`)
    if (!isAllowedPrepareRun(run, runId, identity.commit, runUrl)) {
      throw new Error('Release manifest prepare run is not an allowed tag-push run for this exact commit')
    }
    await assertSuccessfulPrepareAttempt(client, owner, repo, runId, run, identity.commit, runUrl)
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
  // Re-check immediately before the only write. The pre-verification check cannot see a
  // preparation rerun that started after it, and verification takes long enough for one
  // to start; this leaves the residual window at the PATCH itself plus list staleness.
  await assertNoActiveRun(client, {
    repository: options.repository,
    workflowPath: preparePath,
    tag: identity.tag
  })
  return client.request('PATCH', `/repos/${owner}/${repo}/releases/${boundId}`, {
    body: publicationUpdate(identity.tag)
  })
}

function parseOptions(args) {
  const [command, ...rest] = args
  if (!['preflight', 'sync-draft', 'publish'].includes(command)) return null
  const values = {}
  for (const argument of rest) {
    const match = argument.match(/^--(tag|commit|repository|assets|run-id)=(.*)$/)
    if (!match || !match[2] || Object.hasOwn(values, match[1])) return null
    values[match[1]] = match[2]
  }
  if (!values.tag || !values.commit || !values.repository) return null
  // Draft synchronization must know its own run so its refusal guard can never reject the
  // run issuing it; the other commands have no such caller identity and must not accept
  // one.
  if (command === 'sync-draft' && (!values.assets || !values['run-id'])) return null
  if (command !== 'sync-draft' && (values.assets || values['run-id'])) return null
  return {
    command,
    tag: values.tag,
    commit: values.commit,
    repository: values.repository,
    ...(values.assets ? {assets: values.assets} : {}),
    ...(values['run-id'] ? {runId: values['run-id']} : {})
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options) {
    console.error('Usage: release:github -- <preflight|sync-draft|publish> --tag=<tag> --commit=<sha> --repository=<owner/name> [--assets=<dir> --run-id=<id>]')
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
  assertNoActiveRun,
  assertReleaseIdentity,
  findRelease,
  githubClient,
  preflight,
  publicationUpdate,
  publishDraft,
  repositoryParts,
  syncDraft
}
