'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')
const {verifyArtifact} = require('./package-verify.cjs')
const {validateReleaseIdentity} = require('./release-identity.cjs')
const {
  findReleaseTarget,
  releaseArchiveName,
  sha256,
  targetKey
} = require('./release-config.cjs')
const {root} = require('./package-config.cjs')

function runTar(args, operations = {}) {
  const run = operations.spawnSync || spawnSync
  const result = run('tar', args, {encoding: 'utf8', maxBuffer: 10 * 1024 * 1024})
  if (result.error) throw new Error(`Could not run archive tool: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Archive tool failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout
}

function inspectArchive(archivePath, expectedDirectory, operations = {}) {
  const listing = runTar(['-tf', archivePath], operations).split(/\r?\n/).filter(Boolean)
  if (listing.length === 0) throw new Error('Release archive is empty')
  for (const entry of listing) {
    const normalized = entry.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
      throw new Error(`Release archive has an absolute or empty path: ${entry}`)
    }
    const segments = normalized.split('/')
    if (segments.includes('..') || segments[0] !== expectedDirectory) {
      throw new Error(`Release archive escapes its one expected top-level directory: ${entry}`)
    }
  }
  return listing
}

function createReleaseArchive(options, operations = {}) {
  const sourceRoot = options.sourceRoot || root
  const identity = validateReleaseIdentity(options.tag, {sourceRoot})
  if (!/^[0-9a-f]{40}$/.test(options.commit || '') || options.commit !== identity.tagSha) {
    throw new Error('Release commit must exactly match the checked-out tag commit')
  }
  const {artifactPath, record} = verifyArtifact(options.artifact, {sourceRoot, sourcePackage: identity.packageJson})
  if (!record.launchedOnTargetOs || record.launchPlatform !== record.platform || record.launchArch !== record.arch) {
    throw new Error('Release archives require recorded bounded smoke evidence from the exact target host')
  }
  const target = findReleaseTarget(record.platform, record.arch)
  if (!target) throw new Error(`Target is not in the approved release matrix: ${record.platform}/${record.arch}`)
  const expectedDirectory = path.basename(artifactPath)
  const expectedDirectoryName = `electris-v${identity.version}-${record.platform}-${record.arch}`
  if (expectedDirectory !== expectedDirectoryName) throw new Error(`Unexpected package directory: ${expectedDirectory}`)

  const output = path.resolve(sourceRoot, options.output)
  fs.mkdirSync(output, {recursive: true})
  const archiveName = releaseArchiveName(identity.version, target)
  const archivePath = path.join(output, archiveName)
  fs.rmSync(archivePath, {force: true})
  const createArgs = target.extension === 'tar.gz'
    ? ['-czf', archivePath, '-C', path.dirname(artifactPath), expectedDirectory]
    : ['-acf', archivePath, '-C', path.dirname(artifactPath), expectedDirectory]
  runTar(createArgs, operations)
  inspectArchive(archivePath, expectedDirectory, operations)

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-release-extract-'))
  try {
    runTar(['-xf', archivePath, '-C', extractionRoot], operations)
    const extractedPath = path.join(extractionRoot, expectedDirectory)
    verifyArtifact(extractedPath, {sourceRoot, sourcePackage: identity.packageJson})
  } finally {
    fs.rmSync(extractionRoot, {recursive: true, force: true})
  }

  const stat = fs.statSync(archivePath)
  const archiveToolVersion = runTar(['--version'], operations).split(/\r?\n/)[0].trim()
  if (!archiveToolVersion) throw new Error('Archive tool did not report a version')
  const fragment = {
    schemaVersion: 1,
    tag: identity.tag,
    commit: options.commit,
    packageVersion: identity.version,
    electronVersion: record.electronVersion,
    workflow: {
      runId: String(options.runId || ''),
      runUrl: String(options.runUrl || '')
    },
    target: {
      platform: record.platform,
      arch: record.arch,
      key: targetKey(record.platform, record.arch),
      public: target.public
    },
    archive: {
      basename: archiveName,
      bytes: stat.size,
      sha256: sha256(archivePath)
    },
    smoke: {
      passed: true,
      evidence: record.smokeEvidence
    },
    signing: {
      state: 'unsigned',
      notarization: record.platform === 'darwin' ? 'not-notarized' : 'not-applicable'
    },
    archiveTool: {
      command: 'tar',
      version: archiveToolVersion
    }
  }
  const fragmentPath = path.join(output, `release-fragment-${targetKey(record.platform, record.arch)}.json`)
  fs.writeFileSync(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`)
  console.log(`Created and freshly verified ${archivePath}`)
  console.log(`Fragment: ${fragmentPath}`)
  return {archivePath, fragmentPath, fragment}
}

function parseOptions(args) {
  const options = {}
  for (const argument of args) {
    const match = argument.match(/^--(artifact|output|tag|commit|run-id|run-url)=(.*)$/)
    if (!match || !match[2] || Object.hasOwn(options, match[1])) return null
    options[match[1]] = match[2]
  }
  if (Object.keys(options).length !== 6) return null
  return {
    artifact: options.artifact,
    output: options.output,
    tag: options.tag,
    commit: options.commit,
    runId: options['run-id'],
    runUrl: options['run-url']
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options) {
    console.error('Usage: npm run release:archive -- --artifact=<path> --output=<path> --tag=<tag> --commit=<sha> --run-id=<id> --run-url=<url>')
    process.exitCode = 2
    return
  }
  try {
    createReleaseArchive(options)
  } catch (error) {
    console.error(`Release archive failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {createReleaseArchive, inspectArchive, parseOptions, runTar, sha256}
