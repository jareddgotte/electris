'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {projectPackage, root} = require('./package-config.cjs')

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const releaseTargets = Object.freeze([
  Object.freeze({platform: 'linux', arch: 'x64', extension: 'tar.gz', portable: true, public: true}),
  Object.freeze({platform: 'win32', arch: 'x64', extension: 'zip', portable: true, public: true}),
  Object.freeze({platform: 'darwin', arch: 'arm64', extension: 'zip', portable: false, public: false}),
  Object.freeze({platform: 'darwin', arch: 'x64', extension: 'zip', portable: false, public: false})
])

function targetKey(platform, arch) {
  return `${platform}-${arch}`
}

function findReleaseTarget(platform, arch) {
  return releaseTargets.find((target) => target.platform === platform && target.arch === arch)
}

function releaseArchiveName(version, target) {
  const portable = target.portable ? '-portable' : ''
  return `electris-v${version}-${target.platform}-${target.arch}${portable}.${target.extension}`
}

function releaseManifestName(version = projectPackage.version) {
  return `electris-v${version}-release-manifest.json`
}

function checksumsName(version = projectPackage.version) {
  return `electris-v${version}-SHA256SUMS.txt`
}

function releaseNotesPath(tag, sourceRoot = root) {
  return path.join(sourceRoot, 'docs', 'releases', `${tag}.md`)
}

module.exports = {
  checksumsName,
  findReleaseTarget,
  releaseArchiveName,
  releaseManifestName,
  releaseNotesPath,
  releaseTargets,
  sha256,
  targetKey
}
