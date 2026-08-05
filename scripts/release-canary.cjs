'use strict'

const authorizedCanary = Object.freeze({
  tag: 'v0.2.0-rc.2',
  target: 'linux-x64',
  targetFailureValue: 'v0.2.0-rc.2:linux-x64',
  stopAfterUploadValue: 'v0.2.0-rc.2:after-one-upload'
})

function targetFailureCanaryEnabled(value, tag, target) {
  return value === authorizedCanary.targetFailureValue &&
    tag === authorizedCanary.tag && target === authorizedCanary.target
}

function partialDraftCanaryEnabled(value, tag) {
  return value === authorizedCanary.stopAfterUploadValue && tag === authorizedCanary.tag
}

function assertTargetCanary(options) {
  if (!targetFailureCanaryEnabled(options.value, options.tag, options.target)) {
    console.log(`Temporary release target-failure canary is inactive for ${options.tag}/${options.target}`)
    return
  }
  throw new Error(`Authorized temporary release canary intentionally failed ${options.tag}/${options.target}`)
}

function main() {
  if (process.argv.length !== 2) {
    console.error('Usage: release-canary.cjs (workflow environment only)')
    process.exitCode = 2
    return
  }
  try {
    assertTargetCanary({
      value: process.env.ELECTRIS_CANARY_FAIL_TARGET,
      tag: process.env.RELEASE_TAG,
      target: process.env.RELEASE_TARGET
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  assertTargetCanary,
  authorizedCanary,
  partialDraftCanaryEnabled,
  targetFailureCanaryEnabled
}
