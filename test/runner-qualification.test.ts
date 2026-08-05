import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  qualificationRecord,
  runnerTargets,
  writeQualificationRecord
} = require('../scripts/runner-qualification-record.cjs') as {
  qualificationRecord: (record: PackageRecord, runner: string, commit: string) => QualificationRecord
  runnerTargets: Record<string, {platform: string, arch: string}>
  writeQualificationRecord: (
    artifact: string,
    runner: string,
    commit: string,
    operations: {outputRoot: string, verifyArtifact: () => {record: PackageRecord}}
  ) => string
}

interface PackageRecord {
  name: string
  version: string
  electronVersion: string
  platform: string
  arch: string
  launchedOnTargetOs: boolean
  launchPlatform?: string
  launchArch?: string
  smokeEvidence?: string
}

interface QualificationRecord {
  schemaVersion: number
  commit: string
  runner: string
  target: {platform: string, arch: string}
  package: {name: string, version: string, electronVersion: string}
  smoke: {passed: boolean, evidence: string}
}

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'runner-qualification.yml')
const releaseWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'release-prepare.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8')
const commit = 'a'.repeat(40)
const smokeEvidence = 'startup, isolated preload/CSP/navigation, window controls, and score restart passed'

function matchingLines(content: string, fragment: string) {
  return content.split('\n').filter((line) => line.includes(fragment))
}

function packageRecord(values: Partial<PackageRecord> = {}): PackageRecord {
  return {
    name: 'electris',
    version: '0.2.0-rc.1',
    electronVersion: '43.2.0',
    platform: 'linux',
    arch: 'x64',
    launchedOnTargetOs: true,
    launchPlatform: 'linux',
    launchArch: 'x64',
    smokeEvidence,
    ...values
  }
}

describe('runner qualification workflow contract', () => {
  it('is manual-only and rejects every selector except protected master', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:\n\npermissions:/m)
    expect(workflow).not.toMatch(/\n  (?:push|pull_request|pull_request_target|issue_comment|schedule):/)
    expect(workflow).not.toContain('inputs:')
    expect(workflow).toContain("github.ref == 'refs/heads/master'")
    expect(workflow).toContain("github.event.repository.default_branch == 'master'")
    expect(workflow).toContain("runner-qualification.yml@refs/heads/master', github.repository")
    expect(workflow).toContain('ref: ${{ github.sha }}')
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$QUALIFICATION_SHA"')
    expect(workflow).toContain('git merge-base --is-ancestor HEAD refs/remotes/origin/master')
    expect(workflow.indexOf('Establish protected master identity'))
      .toBeLessThan(workflow.indexOf('Use declared Node version'))
  })

  it('keeps permissions, credentials, environments, secrets, and Actions read-only', () => {
    expect(matchingLines(workflow, 'contents: read')).toHaveLength(1)
    expect(workflow).not.toMatch(/\bcontents: write\b|\bid-token: write\b|\bactions: write\b/)
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).not.toMatch(/^\s*environment:/m)
    expect(workflow).not.toMatch(/release-(?:publish|signing)|\$\{\{\s*secrets\.|github\.token|GITHUB_TOKEN/)
    for (const line of matchingLines(workflow, 'uses:')) {
      expect(line).toMatch(/uses: [^@\s]+@[0-9a-f]{40}(?:\s|$)/)
    }
  })

  it('hardcodes the exact native release target matrix and assertion', () => {
    const targets = [...workflow.matchAll(
        /- runner: ([^\n]+)\n\s+platform: ([^\n]+)\n\s+arch: ([^\n]+)/g)]
      .map((match) => ({runner: match[1], platform: match[2], arch: match[3]}))
    expect(targets).toEqual([
      {runner: 'ubuntu-latest', platform: 'linux', arch: 'x64'},
      {runner: 'windows-latest', platform: 'win32', arch: 'x64'},
      {runner: 'macos-15', platform: 'darwin', arch: 'arm64'},
      {runner: 'macos-15-intel', platform: 'darwin', arch: 'x64'}
    ])
    const assertion = matchingLines(releaseWorkflow, "run: node -e \"if (process.platform !==")[0].trim()
    expect(matchingLines(workflow, "run: node -e \"if (process.platform !==").map((line) => line.trim()))
      .toEqual([assertion])
  })

  it('uses only package host, verify, bounded smoke, verify in that order', () => {
    const packageHost = workflow.indexOf('run: npm run package:host')
    const verifies = [...workflow.matchAll(/run: node scripts\/package-verify\.cjs/g)].map((match) => match.index)
    const smoke = workflow.indexOf('run: node scripts/package-smoke.cjs')
    expect(packageHost).toBeGreaterThan(-1)
    expect(verifies).toHaveLength(2)
    expect(packageHost).toBeLessThan(verifies[0])
    expect(verifies[0]).toBeLessThan(smoke)
    expect(smoke).toBeLessThan(verifies[1])
    expect(workflow).not.toMatch(/npm run (?:start|smoke)|release-(?:archive|assets|github)|npm publish/)
  })

  it('uploads only compact, ignored JSON evidence for seven days', () => {
    expect(matchingLines(workflow, 'actions/upload-artifact@')).toHaveLength(1)
    const upload = workflow.slice(workflow.indexOf('actions/upload-artifact@'))
    expect(upload).toContain('path: qualification-records/${{ matrix.platform }}-${{ matrix.arch }}.json')
    expect(upload).toContain('if-no-files-found: error')
    expect(upload).toContain('retention-days: 7')
    expect(upload).not.toMatch(/\bdist\/|release-work|release-assets|\.(?:zip|tar|gz|dmg|exe)\b/)
    expect(fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8'))
      .toContain('/qualification-records/')
  })
})

describe('compact runner qualification records', () => {
  let temporaryRoot: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electris-runner-qualification-'))
  })
  afterEach(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}))

  it('allows only the four reviewed runner and target pairs', () => {
    expect(runnerTargets).toEqual({
      'ubuntu-latest': {platform: 'linux', arch: 'x64'},
      'windows-latest': {platform: 'win32', arch: 'x64'},
      'macos-15': {platform: 'darwin', arch: 'arm64'},
      'macos-15-intel': {platform: 'darwin', arch: 'x64'}
    })
    expect(() => qualificationRecord(packageRecord(), 'ubuntu-24.04', commit))
      .toThrow(/unreviewed runner label/)
    expect(() => qualificationRecord(packageRecord({arch: 'arm64'}), 'ubuntu-latest', commit))
      .toThrow(/requires linux\/x64/)
  })

  it('requires exact matching-host bounded-smoke evidence and a full commit', () => {
    expect(() => qualificationRecord(packageRecord({launchedOnTargetOs: false}), 'ubuntu-latest', commit))
      .toThrow(/not bounded-smoked/)
    expect(() => qualificationRecord(packageRecord(), 'ubuntu-latest', 'master'))
      .toThrow(/full lowercase Git SHA/)
  })

  it('writes one compact JSON record without copying package bytes', () => {
    const outputPath = writeQualificationRecord('unused-artifact', 'ubuntu-latest', commit, {
      outputRoot: temporaryRoot,
      verifyArtifact: () => ({record: packageRecord()})
    })
    expect(path.basename(outputPath)).toBe('linux-x64.json')
    expect(fs.readdirSync(temporaryRoot)).toEqual(['linux-x64.json'])
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      commit,
      runner: 'ubuntu-latest',
      target: {platform: 'linux', arch: 'x64'},
      package: {name: 'electris', version: '0.2.0-rc.1', electronVersion: '43.2.0'},
      smoke: {passed: true, evidence: smokeEvidence}
    })
    expect(fs.statSync(outputPath).size).toBeLessThan(1024)
  })
})
