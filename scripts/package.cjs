'use strict'

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')
const {packager} = require('@electron/packager')
const {
  appFiles,
  artifactName,
  packageRecordName,
  projectPackage,
  root,
  targets
} = require('./package-config.cjs')
const {expectedPackagedPackage, verifyArtifact} = require('./package-verify.cjs')

function usage(message) {
  if (message) console.error(message)
  console.error([
    'Usage:',
    '  npm run package:host',
    '  npm run package:target -- --platform=<darwin|linux|win32> --arch=<reviewed-arch>'
  ].join('\n'))
  process.exitCode = 2
}

function readTarget(args) {
  if (args.length === 1 && args[0] === '--host') {
    return {platform: process.platform, arch: process.arch}
  }

  const values = {}
  for (const argument of args) {
    const match = argument.match(/^--(platform|arch)=([^=]+)$/)
    if (!match || Object.hasOwn(values, match[1])) return null
    values[match[1]] = match[2]
  }
  if (args.length !== 2 || !values.platform || !values.arch) return null
  return values
}

function assertReviewedTarget({platform, arch}) {
  if (!Object.hasOwn(targets, platform) || !targets[platform].includes(arch)) {
    throw new Error(`Unreviewed local packaging target: ${platform}/${arch}`)
  }
}

function runCleanBuild() {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Packaging must run through npm so the pinned build toolchain is used')
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Clean production build failed with exit code ${result.status}`)
}

function copyAllowlistedApplication(stagePath) {
  fs.mkdirSync(stagePath, {recursive: true})
  for (const {source, packaged} of appFiles) {
    const sourcePath = path.join(root, source)
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Required production file is missing after build: ${source}`)
    }
    const destination = path.join(stagePath, packaged)
    fs.mkdirSync(path.dirname(destination), {recursive: true})
    fs.copyFileSync(sourcePath, destination)
  }
  fs.writeFileSync(
      path.join(stagePath, 'package.json'),
      `${JSON.stringify(expectedPackagedPackage(), null, 2)}\n`)
}

async function createPackage(target, operations = {}) {
  assertReviewedTarget(target)
  const name = artifactName(target.platform, target.arch)
  const distPath = operations.distPath || path.join(root, 'dist')
  const finalPath = path.join(distPath, name)
  const workPath = path.join(distPath, `.package-work-${target.platform}-${target.arch}`)
  const stagePath = path.join(workPath, 'source')
  const outPath = path.join(workPath, 'output')
  let complete = false

  fs.mkdirSync(distPath, {recursive: true})
  fs.rmSync(finalPath, {recursive: true, force: true})
  fs.rmSync(workPath, {recursive: true, force: true})

  try {
    const build = operations.runCleanBuild || runCleanBuild
    build()
    copyAllowlistedApplication(stagePath)

    const outputs = await packager({
      dir: stagePath,
      name: projectPackage.name,
      executableName: projectPackage.name,
      appBundleId: 'com.jaredgotte.electris',
      appVersion: projectPackage.version,
      buildVersion: projectPackage.version,
      electronVersion: projectPackage.devDependencies.electron,
      platform: target.platform,
      arch: target.arch,
      out: outPath,
      asar: true,
      prune: true,
      overwrite: false,
      osxSign: false
    })
    if (outputs.length !== 1) throw new Error(`Packager returned ${outputs.length} outputs instead of one`)

    fs.renameSync(outputs[0], finalPath)
    const record = {
      schemaVersion: 1,
      name: projectPackage.name,
      version: projectPackage.version,
      electronVersion: projectPackage.devDependencies.electron,
      platform: target.platform,
      arch: target.arch,
      outputPath: `dist/${name}`,
      launchedOnTargetOs: false
    }
    fs.writeFileSync(path.join(finalPath, packageRecordName), `${JSON.stringify(record, null, 2)}\n`)
    verifyArtifact(finalPath)
    complete = true

    console.log(`Packaged Electris ${record.version} / Electron ${record.electronVersion} / ${record.platform}/${record.arch}`)
    console.log(`Output: ${finalPath}`)
    console.log('Launched on target OS: no (run package:smoke on a matching host)')
    return finalPath
  } finally {
    fs.rmSync(workPath, {recursive: true, force: true})
    if (!complete) fs.rmSync(finalPath, {recursive: true, force: true})
  }
}

async function main() {
  const target = readTarget(process.argv.slice(2))
  if (!target) return usage('Platform and architecture must both be explicit.')

  try {
    await createPackage(target)
  } catch (error) {
    console.error(`Packaging failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()

module.exports = {assertReviewedTarget, createPackage, readTarget}
