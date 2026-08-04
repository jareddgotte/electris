'use strict'

const fs = require('fs')
const path = require('path')
const {
  checksumsName,
  releaseArchiveName,
  releaseManifestName,
  releaseTargets,
  targetKey
} = require('./release-config.cjs')
const {parseReleaseTag} = require('./release-identity.cjs')
const {sha256} = require('./release-archive.cjs')

function walkFiles(directory) {
  const files = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile()) files.push(absolute)
      else throw new Error(`Release staging contains a non-file entry: ${absolute}`)
    }
  }
  return files.sort()
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${label} ${filePath}: ${error.message}`)
  }
}

function assertFragment(fragment, target, identity) {
  const key = targetKey(target.platform, target.arch)
  if (fragment.schemaVersion !== 1 || fragment.tag !== identity.tag ||
      fragment.packageVersion !== identity.version || fragment.commit !== identity.commit) {
    throw new Error(`Release fragment identity mismatch for ${key}`)
  }
  if (fragment.target?.key !== key || fragment.target.platform !== target.platform ||
      fragment.target.arch !== target.arch || fragment.target.public !== target.public) {
    throw new Error(`Release fragment target policy mismatch for ${key}`)
  }
  if (fragment.archive?.basename !== releaseArchiveName(identity.version, target) ||
      !Number.isSafeInteger(fragment.archive.bytes) || fragment.archive.bytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(fragment.archive.sha256 || '')) {
    throw new Error(`Release fragment archive metadata is invalid for ${key}`)
  }
  if (typeof fragment.electronVersion !== 'string' || !fragment.electronVersion ||
      !/^\d+$/.test(fragment.workflow?.runId || '') ||
      !/^https:\/\//.test(fragment.workflow?.runUrl || '')) {
    throw new Error(`Release fragment lacks Electron or workflow identity for ${key}`)
  }
  if (fragment.archiveTool?.command !== 'tar' || typeof fragment.archiveTool.version !== 'string' ||
      !fragment.archiveTool.version) {
    throw new Error(`Release fragment lacks archive tool/version identity for ${key}`)
  }
  if (fragment.smoke?.passed !== true || typeof fragment.smoke.evidence !== 'string' || !fragment.smoke.evidence) {
    throw new Error(`Release fragment lacks matching-host smoke evidence for ${key}`)
  }
  if (fragment.signing?.state !== 'unsigned') throw new Error(`Unexpected signing state for ${key}`)
  if (target.platform === 'darwin' &&
      (target.public || fragment.signing.notarization !== 'not-notarized')) {
    throw new Error(`Unsigned macOS target cannot enter the public release asset set: ${key}`)
  }
}

function assembleReleaseAssets(options) {
  const parsed = parseReleaseTag(options.tag)
  if (!/^[0-9a-f]{40}$/.test(options.commit || '')) throw new Error('Release commit must be a full lowercase Git SHA')
  const input = path.resolve(options.input)
  const output = path.resolve(options.output)
  const files = walkFiles(input)
  const fragmentFiles = files.filter((file) => /^release-fragment-.+\.json$/.test(path.basename(file)))
  if (fragmentFiles.length !== releaseTargets.length) {
    throw new Error(`Expected ${releaseTargets.length} release fragments, found ${fragmentFiles.length}`)
  }
  const fragments = new Map()
  for (const file of fragmentFiles) {
    const fragment = readJson(file, 'release fragment')
    const key = fragment.target?.key
    if (!key || fragments.has(key)) throw new Error(`Duplicate or unidentified release fragment: ${key || path.basename(file)}`)
    fragments.set(key, {fragment, file})
  }

  const identity = {tag: parsed.tag, version: parsed.version, commit: options.commit}
  const entries = []
  fs.rmSync(output, {recursive: true, force: true})
  fs.mkdirSync(output, {recursive: true})
  for (const target of releaseTargets) {
    const key = targetKey(target.platform, target.arch)
    const item = fragments.get(key)
    if (!item) throw new Error(`Missing required release target: ${key}`)
    assertFragment(item.fragment, target, identity)
    const candidates = files.filter((file) => path.basename(file) === item.fragment.archive.basename)
    if (candidates.length !== 1) throw new Error(`Expected one staged archive for ${key}, found ${candidates.length}`)
    const archivePath = candidates[0]
    const stat = fs.statSync(archivePath)
    const digest = sha256(archivePath)
    if (stat.size !== item.fragment.archive.bytes || digest !== item.fragment.archive.sha256) {
      throw new Error(`Staged archive bytes differ from the ${key} fragment`)
    }
    if (target.public) fs.copyFileSync(archivePath, path.join(output, path.basename(archivePath)))
    entries.push(item.fragment)
  }

  const electronVersions = new Set(entries.map((entry) => entry.electronVersion))
  const workflowRuns = new Set(entries.map((entry) => `${entry.workflow.runId}\n${entry.workflow.runUrl}`))
  if (electronVersions.size !== 1 || workflowRuns.size !== 1) {
    throw new Error('All release targets must come from one Electron version and workflow run')
  }

  const manifest = {
    schemaVersion: 1,
    tag: parsed.tag,
    releaseName: parsed.tag,
    commit: options.commit,
    packageVersion: parsed.version,
    prerelease: parsed.prerelease !== null,
    publicationPolicy: {
      publicTargets: releaseTargets.filter((target) => target.public).map(({platform, arch}) => targetKey(platform, arch)),
      qualificationOnlyTargets: releaseTargets.filter((target) => !target.public).map(({platform, arch}) => targetKey(platform, arch)),
      unsignedWindowsAllowed: true,
      unsignedMacosPublic: false
    },
    targets: entries
  }
  const manifestPath = path.join(output, releaseManifestName(parsed.version))
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const coveredFiles = [
    ...entries.filter((entry) => entry.target.public).map((entry) => entry.archive.basename),
    path.basename(manifestPath)
  ].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  const sums = coveredFiles.map((basename) => `${sha256(path.join(output, basename))}  ${basename}`).join('\n')
  fs.writeFileSync(path.join(output, checksumsName(parsed.version)), `${sums}\n`)
  verifyReleaseSet(output, parsed.tag, options.commit)
  return {manifest, output}
}

function parseChecksums(content) {
  const values = new Map()
  for (const line of content.trimEnd().split('\n')) {
    const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/)
    if (!match || values.has(match[2])) throw new Error(`Invalid or duplicate SHA256SUMS entry: ${line}`)
    values.set(match[2], match[1])
  }
  const names = [...values.keys()]
  const sorted = [...names].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  if (JSON.stringify(names) !== JSON.stringify(sorted)) throw new Error('SHA256SUMS entries are not sorted bytewise')
  return values
}

function verifyReleaseSet(directory, tag, expectedCommit) {
  const parsed = parseReleaseTag(tag)
  const releaseDirectory = path.resolve(directory)
  const files = fs.readdirSync(releaseDirectory, {withFileTypes: true})
  if (files.some((entry) => !entry.isFile())) throw new Error('Release set may contain files only')
  const expectedArchives = releaseTargets.filter((target) => target.public)
      .map((target) => releaseArchiveName(parsed.version, target))
  const expectedNames = [...expectedArchives, releaseManifestName(parsed.version), checksumsName(parsed.version)].sort()
  const actualNames = files.map((entry) => entry.name).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Release asset set mismatch; expected=[${expectedNames.join(', ')}], actual=[${actualNames.join(', ')}]`)
  }
  const manifest = readJson(path.join(releaseDirectory, releaseManifestName(parsed.version)), 'release manifest')
  if (manifest.schemaVersion !== 1 || manifest.tag !== tag || manifest.releaseName !== tag ||
      manifest.packageVersion !== parsed.version || manifest.prerelease !== (parsed.prerelease !== null) ||
      (expectedCommit && manifest.commit !== expectedCommit)) {
    throw new Error('Release manifest identity does not match the requested release')
  }
  const expectedTargetKeys = releaseTargets.map(({platform, arch}) => targetKey(platform, arch))
  const actualTargetKeys = manifest.targets?.map((entry) => entry.target?.key)
  if (JSON.stringify(actualTargetKeys) !== JSON.stringify(expectedTargetKeys)) {
    throw new Error('Release manifest target matrix is missing, extra, duplicated, or out of order')
  }
  for (let index = 0; index < releaseTargets.length; index++) {
    assertFragment(manifest.targets[index], releaseTargets[index], {
      tag,
      version: parsed.version,
      commit: manifest.commit
    })
  }
  const checksums = parseChecksums(fs.readFileSync(path.join(releaseDirectory, checksumsName(parsed.version)), 'utf8'))
  const expectedCovered = [...expectedArchives, releaseManifestName(parsed.version)].sort()
  if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(expectedCovered)) {
    throw new Error('SHA256SUMS does not cover the exact public archive and manifest set')
  }
  for (const [basename, digest] of checksums) {
    if (sha256(path.join(releaseDirectory, basename)) !== digest) throw new Error(`SHA-256 mismatch for ${basename}`)
  }
  return manifest
}

function parseOptions(args) {
  const values = {}
  for (const argument of args) {
    const match = argument.match(/^--(input|output|dir|tag|commit)=(.*)$/)
    if (!match || !match[2] || Object.hasOwn(values, match[1])) return null
    values[match[1]] = match[2]
  }
  if (!values.tag || !values.commit) return null
  if (values.input && values.output && !values.dir && Object.keys(values).length === 4) return {command: 'assemble', ...values}
  if (values.dir && !values.input && !values.output && Object.keys(values).length === 3) return {command: 'verify', ...values}
  return null
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options) {
    console.error('Usage: release:assemble -- --input=<staging> --output=<release> --tag=<tag> --commit=<sha>\n   or: release:verify-assets -- --dir=<release> --tag=<tag> --commit=<sha>')
    process.exitCode = 2
    return
  }
  try {
    if (options.command === 'assemble') assembleReleaseAssets(options)
    else verifyReleaseSet(options.dir, options.tag, options.commit)
    console.log(`Release assets ${options.command === 'assemble' ? 'assembled' : 'verified'} for ${options.tag}`)
  } catch (error) {
    console.error(`Release assets failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  assembleReleaseAssets,
  parseChecksums,
  verifyReleaseSet,
  walkFiles
}
