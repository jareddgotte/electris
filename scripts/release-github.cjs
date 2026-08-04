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
  releaseTargets
} = require('./release-config.cjs')
const {sha256} = require('./release-archive.cjs')
const {verifyReleaseSet} = require('./release-assets.cjs')
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

async function findRelease(client, repository, tag) {
  const {owner, repo} = repositoryParts(repository)
  return client.request('GET', `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {allow404: true})
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
    release = await client.request('POST', `/repos/${owner}/${repo}/releases`, {body: {
      tag_name: identity.tag,
      target_commitish: identity.commit,
      name: identity.tag,
      body: notes,
      draft: true,
      prerelease: identity.prerelease,
      generate_release_notes: false
    }})
  } else {
    assertReleaseIdentity(release, identity, notes)
  }

  const expectedFiles = fs.readdirSync(options.assets, {withFileTypes: true})
      .filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  const existing = mapAssets(release.assets)
  const extras = [...existing.keys()].filter((name) => !expectedFiles.includes(name))
  if (extras.length > 0) throw new Error(`Draft release has unexpected assets: ${extras.join(', ')}`)
  for (const basename of expectedFiles) {
    const localPath = path.join(options.assets, basename)
    const asset = existing.get(basename)
    if (asset) {
      if (asset.size !== fs.statSync(localPath).size) throw new Error(`Existing draft asset size differs: ${basename}`)
      const bytes = await downloadAsset(client, asset)
      const temporary = path.join(os.tmpdir(), `electris-existing-${process.pid}-${basename}`)
      try {
        fs.writeFileSync(temporary, bytes)
        if (sha256(temporary) !== sha256(localPath)) throw new Error(`Existing draft asset bytes differ: ${basename}`)
      } finally {
        fs.rmSync(temporary, {force: true})
      }
      continue
    }
    const encodedName = encodeURIComponent(basename)
    await client.request('POST', `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodedName}`, {
      body: fs.readFileSync(localPath),
      contentType: 'application/octet-stream'
    })
  }
  return release
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
        !['push', 'workflow_dispatch'].includes(run.event) ||
        !String(run.path || '').startsWith('.github/workflows/release-prepare.yml') ||
        run.html_url !== [...runUrls][0]) {
      throw new Error('Release manifest prepare run is not a successful allowed run for this exact commit')
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true})
  }
  return client.request('PATCH', `/repos/${owner}/${repo}/releases/${release.id}`, {
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
    if (options.command === 'sync-draft') await syncDraft(options)
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
  githubClient,
  preflight,
  publicationUpdate,
  publishDraft,
  repositoryParts,
  syncDraft
}
