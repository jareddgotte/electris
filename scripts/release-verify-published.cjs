'use strict'

const fs = require('fs')
const path = require('path')
const {parseReleaseTag} = require('./release-identity.cjs')
const {
  checksumsName,
  findReleaseTarget,
  releaseArchiveName,
  releaseManifestName,
  releaseTargets,
  sha256,
  targetKey
} = require('./release-config.cjs')
const {verifyReleaseSet} = require('./release-assets.cjs')
const {inspectArchive, runTar} = require('./release-archive.cjs')
const {findRelease, githubClient, repositoryParts} = require('./release-github.cjs')
const {verifyArtifact} = require('./package-verify.cjs')
const {root} = require('./package-config.cjs')
const {runnerTargets} = require('./runner-qualification-record.cjs')

const identityRecordName = 'release-identity.json'
const smokeEvidence = 'startup, isolated preload/CSP/navigation, window controls, and score restart passed'

function fail(message) {
  throw new Error(`Published release verification failed: ${message}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function parseReleaseId(value) {
  assert(/^[1-9][0-9]*$/.test(String(value || '')), `release ID must be one positive integer: ${value}`)
  const id = Number(value)
  assert(Number.isSafeInteger(id), `release ID is out of range: ${value}`)
  return id
}

function expectedAssetNames(version) {
  return [
    ...releaseTargets.filter((target) => target.public).map((target) => releaseArchiveName(version, target)),
    releaseManifestName(version),
    checksumsName(version)
  ].sort()
}

// Post-publication verification must prove what the public actually receives, so asset
// bytes are fetched from the unauthenticated browser download URL rather than the
// authenticated asset API. The exact canonical URL is required: following whatever URL
// the API reports would verify bytes this repository never published. Release metadata
// is still read with the read-only workflow token, which keeps discovery inside the same
// stable paginated exact-tag path preparation and publication already use, and away from
// the anonymous rate limit shared by every hosted runner on a given address.
function publicDownloadUrl(repository, tag, name) {
  const {owner, repo} = repositoryParts(repository)
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`
}

function assertPublishedIdentity(release, identity) {
  assert(release, `no GitHub Release exists for exact tag ${identity.tag}`)
  assert(release.id === identity.releaseId,
      `release ID for tag ${identity.tag} is ${release.id}, not the selected ${identity.releaseId}`)
  assert(release.tag_name === identity.tag && release.name === identity.tag,
      `release ${identity.releaseId} does not identify tag ${identity.tag}`)
  assert(release.draft === false, `release ${identity.releaseId} is still a draft and is not published`)
  assert(typeof release.published_at === 'string' && release.published_at,
      `release ${identity.releaseId} has no publication timestamp`)
  assert(release.prerelease === identity.prerelease,
      `release ${identity.releaseId} channel is prerelease=${release.prerelease}, expected ${identity.prerelease}`)
}

function assertExactAssetSet(assets, version) {
  const names = (assets || []).map((asset) => asset.name)
  assert(new Set(names).size === names.length, `release has duplicate asset names: ${names.join(', ')}`)
  const expected = expectedAssetNames(version)
  const actual = [...names].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((name) => !actual.includes(name))
    const extra = actual.filter((name) => !expected.includes(name))
    fail(`public asset set mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`)
  }
  return expected
}

function assertEmptyTarget(directory, label) {
  if (!fs.existsSync(directory)) return
  assert(fs.statSync(directory).isDirectory(), `${label} exists and is not a directory: ${directory}`)
  const entries = fs.readdirSync(directory)
  assert(entries.length === 0, `${label} already exists and is not empty: ${directory}`)
}

async function downloadPublicAsset(asset, destination, expectedUrl, operations = {}) {
  const fetchImpl = operations.fetch || fetch
  assert(asset.state === 'uploaded', `asset ${asset.name} is in state ${asset.state}, not uploaded`)
  assert(path.basename(asset.name) === asset.name && !asset.name.startsWith('.'),
      `unsafe release asset name: ${asset.name}`)
  assert(asset.browser_download_url === expectedUrl,
      `asset ${asset.name} is served from ${asset.browser_download_url}, not ${expectedUrl}`)
  const response = await fetchImpl(expectedUrl, {redirect: 'follow'})
  assert(response.ok, `anonymous download of ${asset.name} failed with HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert(bytes.length === asset.size,
      `anonymous download of ${asset.name} returned ${bytes.length} bytes, release reports ${asset.size}`)
  fs.writeFileSync(destination, bytes)
  const digest = sha256(destination)
  // GitHub reports an asset digest only on releases created after that field shipped.
  // Check it when present and never treat its absence as a pass, because SHA256SUMS
  // verification below is the authoritative digest gate either way.
  if (typeof asset.digest === 'string' && asset.digest) {
    assert(asset.digest === `sha256:${digest}`,
        `asset ${asset.name} digest is ${asset.digest}, downloaded bytes hash to sha256:${digest}`)
  }
  return {id: asset.id, name: asset.name, size: asset.size, sha256: digest}
}

async function downloadPublishedRelease(options, operations = {}) {
  const parsed = parseReleaseTag(options.tag)
  const identity = {
    tag: parsed.tag,
    version: parsed.version,
    releaseId: parseReleaseId(options.releaseId),
    prerelease: parsed.prerelease !== null
  }
  const client = operations.client || githubClient()
  const release = await findRelease(client, options.repository, identity.tag)
  assertPublishedIdentity(release, identity)
  const names = assertExactAssetSet(release.assets, identity.version)
  const byName = new Map(release.assets.map((asset) => [asset.name, asset]))

  const output = path.resolve(root, options.output)
  assertEmptyTarget(output, 'Public asset directory')
  fs.mkdirSync(output, {recursive: true})
  const assets = []
  for (const name of names) {
    assets.push(await downloadPublicAsset(byName.get(name), path.join(output, name),
        publicDownloadUrl(options.repository, identity.tag, name), operations))
  }

  const record = {
    schemaVersion: 1,
    tag: identity.tag,
    releaseId: identity.releaseId,
    repository: options.repository,
    packageVersion: identity.version,
    release: {
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      targetCommitish: release.target_commitish,
      htmlUrl: release.html_url
    },
    assets
  }
  const recordPath = path.join(path.resolve(root, options.records), identityRecordName)
  fs.mkdirSync(path.dirname(recordPath), {recursive: true})
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  return {record, output, recordPath}
}

function extractPublicArchive(options, operations = {}) {
  const parsed = parseReleaseTag(options.tag)
  const [platform, arch] = String(options.target || '').split('-')
  const target = findReleaseTarget(platform, arch)
  assert(target && target.public, `not a public release target: ${options.target}`)

  // Verify names, digests, and manifest before opening any archive, so extraction can
  // never run on bytes this repository has not already proved are the published set.
  const assetsDirectory = path.resolve(root, options.dir)
  verifyReleaseSet(assetsDirectory, parsed.tag, options.commit)

  const archivePath = path.join(assetsDirectory, releaseArchiveName(parsed.version, target))
  const expectedDirectory = `electris-v${parsed.version}-${target.platform}-${target.arch}`
  inspectArchive(archivePath, expectedDirectory, operations)

  const output = path.resolve(root, options.output)
  assertEmptyTarget(output, 'Extraction directory')
  fs.mkdirSync(output, {recursive: true})
  runTar(['-xf', archivePath, '-C', output], operations)
  const extracted = fs.readdirSync(output)
  assert(JSON.stringify(extracted) === JSON.stringify([expectedDirectory]),
      `extraction produced [${extracted.join(', ')}], expected only ${expectedDirectory}`)
  return path.join(output, expectedDirectory)
}

function writeVerificationRecord(options, operations = {}) {
  const verify = operations.verifyArtifact || verifyArtifact
  const parsed = parseReleaseTag(options.tag)
  const target = runnerTargets[options.runner]
  assert(target, `unreviewed runner label: ${options.runner}`)
  const releaseTarget = findReleaseTarget(target.platform, target.arch)
  assert(releaseTarget && releaseTarget.public,
      `runner ${options.runner} is not a public release target host`)
  assert(/^[0-9a-f]{40}$/.test(options.commit || ''), 'commit must be one full lowercase Git SHA')

  const recordsRoot = path.resolve(root, options.records)
  const identityRecord = JSON.parse(fs.readFileSync(path.join(recordsRoot, identityRecordName), 'utf8'))
  assert(identityRecord.tag === parsed.tag && identityRecord.releaseId === parseReleaseId(options.releaseId),
      'downloaded release identity record does not describe the selected release')

  const {record} = verify(options.artifact)
  assert(record.version === parsed.version,
      `extracted package is version ${record.version}, tag ${parsed.tag} requires ${parsed.version}`)
  assert(record.platform === target.platform && record.arch === target.arch,
      `extracted package is ${record.platform}/${record.arch}, runner ${options.runner} verifies ${target.platform}/${target.arch}`)
  assert(record.launchedOnTargetOs === true && record.launchPlatform === target.platform &&
      record.launchArch === target.arch && record.smokeEvidence === smokeEvidence,
      'published package did not record the bounded smoke on this exact host')

  const archiveBasename = releaseArchiveName(parsed.version, releaseTarget)
  const archive = identityRecord.assets.find((asset) => asset.name === archiveBasename)
  assert(archive, `downloaded release identity record has no ${archiveBasename} entry`)

  const evidence = {
    schemaVersion: 1,
    tag: parsed.tag,
    releaseId: identityRecord.releaseId,
    commit: options.commit,
    repository: identityRecord.repository,
    publishedAt: identityRecord.release.publishedAt,
    runner: options.runner,
    target,
    archive: {basename: archive.name, bytes: archive.size, sha256: archive.sha256},
    package: {name: record.name, version: record.version, electronVersion: record.electronVersion},
    smoke: {passed: true, evidence: record.smokeEvidence}
  }
  const outputPath = path.join(recordsRoot, `verified-${targetKey(target.platform, target.arch)}.json`)
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  return outputPath
}

function parseOptions(args) {
  const [command, ...rest] = args
  if (!['download', 'extract', 'record'].includes(command)) return null
  const values = {}
  for (const argument of rest) {
    const match = argument.match(/^--(tag|release-id|repository|output|records|dir|commit|target|artifact|runner)=(.*)$/)
    if (!match || !match[2] || Object.hasOwn(values, match[1])) return null
    values[match[1]] = match[2]
  }
  const required = {
    download: ['tag', 'release-id', 'repository', 'output', 'records'],
    extract: ['tag', 'commit', 'target', 'dir', 'output'],
    record: ['tag', 'release-id', 'commit', 'runner', 'artifact', 'records']
  }[command]
  if (JSON.stringify(Object.keys(values).sort()) !== JSON.stringify([...required].sort())) return null
  return {command, releaseId: values['release-id'], ...values}
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options) {
    console.error('Usage: release:verify-published -- download --tag=<tag> --release-id=<id> --repository=<owner/name> --output=<dir> --records=<dir>')
    console.error('   or: release:verify-published -- extract --tag=<tag> --commit=<sha> --target=<platform-arch> --dir=<assets> --output=<dir>')
    console.error('   or: release:verify-published -- record --tag=<tag> --release-id=<id> --commit=<sha> --runner=<label> --artifact=<path> --records=<dir>')
    process.exitCode = 2
    return
  }
  try {
    if (options.command === 'download') {
      const {record, output} = await downloadPublishedRelease(options)
      console.log(`Downloaded the ${record.assets.length} public assets of ${record.tag} (release ${record.releaseId}) to ${output}`)
      for (const asset of record.assets) console.log(`  ${asset.sha256}  ${asset.name}`)
    }
    if (options.command === 'extract') {
      const packagePath = extractPublicArchive(options)
      writeOutput('package-path', packagePath)
      console.log(`Extracted the verified public ${options.target} archive to ${packagePath}`)
    }
    if (options.command === 'record') {
      const outputPath = writeVerificationRecord(options)
      console.log(`Wrote compact published-release verification record: ${outputPath}`)
    }
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}

if (require.main === module) void main()

module.exports = {
  assertExactAssetSet,
  assertPublishedIdentity,
  downloadPublishedRelease,
  expectedAssetNames,
  extractPublicArchive,
  parseOptions,
  publicDownloadUrl,
  writeVerificationRecord
}
