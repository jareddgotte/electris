'use strict'

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')
const {root} = require('./package-config.cjs')
const {releaseNotesPath} = require('./release-config.cjs')

const strictTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9A-Za-z-]*))*))?$/
const archivedTags = new Set(['v0.1.0', 'v0.1.1', 'v0.1.2'])

function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || tag.includes('/') || tag.includes('..')) {
    throw new Error('Release tag must be a single strict SemVer tag')
  }
  const match = tag.match(strictTagPattern)
  if (!match) throw new Error(`Release tag is not strict SemVer without build metadata: ${tag}`)
  const version = tag.slice(1)
  return {
    tag,
    version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null
  }
}

function nativeBuildVersion(version) {
  const parsed = parseReleaseTag(`v${version}`)
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`)
  }
}

function runGit(args, cwd = root) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'})
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.trim()
}

function validateFiles(tag, sourceRoot = root) {
  const parsed = parseReleaseTag(tag)
  const packageJson = readJson(path.join(sourceRoot, 'package.json'), 'package.json')
  const packageLock = readJson(path.join(sourceRoot, 'package-lock.json'), 'package-lock.json')
  if (packageJson.version !== parsed.version) {
    throw new Error(`Tag ${tag} does not match package.json version ${packageJson.version}`)
  }
  if (packageLock.version !== parsed.version || packageLock.packages?.['']?.version !== parsed.version) {
    throw new Error('Both package-lock.json version fields must exactly match package.json')
  }
  const notesPath = releaseNotesPath(tag, sourceRoot)
  if (!fs.existsSync(notesPath) || !fs.statSync(notesPath).isFile()) {
    throw new Error(`Committed release notes are missing: docs/releases/${tag}.md`)
  }
  return {...parsed, packageJson, packageLock, notesPath}
}

function validateGitIdentity(tag, options = {}) {
  if (archivedTags.has(tag)) throw new Error(`${tag} is an immutable archival release and cannot be prepared again`)
  const cwd = options.sourceRoot || root
  const tagRef = `refs/tags/${tag}`
  const tagSha = runGit(['rev-parse', '--verify', `${tagRef}^{commit}`], cwd)
  const headSha = runGit(['rev-parse', 'HEAD'], cwd)
  if (headSha !== tagSha) throw new Error(`Checked-out HEAD ${headSha} is not tagged commit ${tagSha}`)
  const masterRef = options.masterRef || 'refs/remotes/origin/master'
  runGit(['merge-base', '--is-ancestor', tagSha, masterRef], cwd)
  return {tagSha, headSha, masterRef}
}

function validateReleaseIdentity(tag, options = {}) {
  const files = validateFiles(tag, options.sourceRoot)
  const git = options.skipGit ? {} : validateGitIdentity(tag, options)
  return {...files, ...git}
}

function readTagArgument(args) {
  if (args.length !== 1 || !args[0].startsWith('--tag=')) return null
  return args[0].slice('--tag='.length)
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function main() {
  const tag = readTagArgument(process.argv.slice(2))
  if (!tag) {
    console.error('Usage: npm run release:identity -- --tag=v<strict-semver>')
    process.exitCode = 2
    return
  }
  try {
    const identity = validateReleaseIdentity(tag)
    writeOutput('tag', identity.tag)
    writeOutput('version', identity.version)
    writeOutput('sha', identity.tagSha)
    writeOutput('prerelease', String(identity.prerelease !== null))
    console.log(`Validated ${identity.tag} at ${identity.tagSha}`)
  } catch (error) {
    console.error(`Release identity failed: ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  archivedTags,
  nativeBuildVersion,
  parseReleaseTag,
  readTagArgument,
  validateFiles,
  validateGitIdentity,
  validateReleaseIdentity
}
