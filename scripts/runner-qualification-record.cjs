'use strict'

const fs = require('fs')
const path = require('path')
const {root} = require('./package-config.cjs')
const {verifyArtifact} = require('./package-verify.cjs')

const runnerTargets = Object.freeze({
  'ubuntu-latest': Object.freeze({platform: 'linux', arch: 'x64'}),
  'windows-latest': Object.freeze({platform: 'win32', arch: 'x64'}),
  'macos-15': Object.freeze({platform: 'darwin', arch: 'arm64'}),
  'macos-15-intel': Object.freeze({platform: 'darwin', arch: 'x64'})
})

function assert(condition, message) {
  if (!condition) throw new Error(`Runner qualification record failed: ${message}`)
}

function qualificationRecord(record, runner, commit) {
  const target = runnerTargets[runner]
  assert(target, `unreviewed runner label: ${runner}`)
  assert(/^[0-9a-f]{40}$/.test(commit), 'commit must be one full lowercase Git SHA')
  assert(record.platform === target.platform && record.arch === target.arch,
      `runner ${runner} requires ${target.platform}/${target.arch}, record says ${record.platform}/${record.arch}`)
  assert(record.launchedOnTargetOs === true &&
      record.launchPlatform === target.platform && record.launchArch === target.arch,
      'package was not bounded-smoked on the exact target')
  assert(record.smokeEvidence ===
      'startup, isolated preload/CSP/navigation, window controls, and score restart passed',
      'package does not contain the expected bounded-smoke evidence')

  return {
    schemaVersion: 1,
    commit,
    runner,
    target,
    package: {
      name: record.name,
      version: record.version,
      electronVersion: record.electronVersion
    },
    smoke: {
      passed: true,
      evidence: record.smokeEvidence
    }
  }
}

function writeQualificationRecord(artifactArgument, runner, commit, operations = {}) {
  const verify = operations.verifyArtifact || verifyArtifact
  const outputRoot = operations.outputRoot || path.join(root, 'qualification-records')
  const {record} = verify(artifactArgument)
  const evidence = qualificationRecord(record, runner, commit)
  const outputPath = path.join(outputRoot, `${evidence.target.platform}-${evidence.target.arch}.json`)
  fs.mkdirSync(outputRoot, {recursive: true})
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  return outputPath
}

function main() {
  if (process.argv.length !== 5) {
    console.error('Usage: node scripts/runner-qualification-record.cjs <artifact-path> <runner-label> <commit>')
    process.exitCode = 2
    return
  }

  try {
    const outputPath = writeQualificationRecord(process.argv[2], process.argv[3], process.argv[4])
    console.log(`Wrote compact runner qualification record: ${outputPath}`)
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {qualificationRecord, runnerTargets, writeQualificationRecord}
