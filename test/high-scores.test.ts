import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import zlib from 'zlib'
import { DEFAULT_HIGH_SCORES, type HighScoreList } from '../src/electris'

const deflate = promisify(zlib.deflate)
const inflate = promisify(zlib.inflate)
const temporaryRoots: string[] = []
let appPaths = {appData: '', userData: ''}

vi.mock('electron', () => ({
  app: {
    getPath: (name: keyof typeof appPaths) => appPaths[name]
  }
}))

async function useDifferentPaths() {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-scores-'))
  temporaryRoots.push(appData)
  // A source run passes app/main.js to Electron, so the default app identity
  // puts userData under <appData>/Electron while the legacy store used electris.
  appPaths = {
    appData,
    userData: path.join(appData, 'Electron')
  }
  return {
    authoritative: path.join(appPaths.userData, 'Electris.config.dat'),
    legacy: path.join(appData, 'electris', 'Electris.config.dat')
  }
}

async function writeCompressed(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), {recursive: true})
  await fs.writeFile(filePath, await deflate(Buffer.from(JSON.stringify(value))))
}

async function writeCompressedJson(filePath: string, json: string) {
  await fs.mkdir(path.dirname(filePath), {recursive: true})
  await fs.writeFile(filePath, await deflate(Buffer.from(json)))
}

async function readCompressed(filePath: string) {
  const value = await inflate(await fs.readFile(filePath))
  return JSON.parse(value.toString('utf8')) as unknown
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the file operation')
}

beforeEach(() => {
  appPaths = {appData: '', userData: ''}
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, {recursive: true, force: true})))
})

describe('high-score path migration', () => {
  it('uses the authoritative file directly when the legacy and userData paths are the same', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-scores-'))
    temporaryRoots.push(root)
    appPaths = {
      appData: root,
      userData: path.join(root, 'electris')
    }
    const scorePath = path.join(appPaths.userData, 'Electris.config.dat')
    await writeCompressed(scorePath, {highScores: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]})
    const readFile = vi.spyOn(fs, 'readFile')
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('copies valid legacy data into a different authoritative path once', async () => {
    const paths = await useDifferentPaths()
    await writeCompressed(paths.legacy, {
      highScores: ['1', '10', '2', '9', '3', '8', '4', '7', '5', '6']
    })
    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()

    await expect(store.load()).resolves.toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    await expect(readCompressed(paths.authoritative)).resolves.toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    await expect(fs.access(paths.legacy)).resolves.toBeUndefined()

    await writeCompressed(paths.legacy, {highScores: [99, 98, 97, 96, 95, 94, 93, 92, 91, 90]})
    await expect(store.load()).resolves.toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('never overwrites an existing authoritative file with legacy data', async () => {
    const paths = await useDifferentPaths()
    const authoritativeScores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    await writeCompressed(paths.authoritative, authoritativeScores)
    await writeCompressed(paths.legacy, {highScores: [99, 98, 97, 96, 95, 94, 93, 92, 91, 90]})
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual(authoritativeScores)
    await expect(readCompressed(paths.authoritative)).resolves.toEqual(authoritativeScores)
  })

  it('does not replace corrupt authoritative data with a legacy file', async () => {
    const paths = await useDifferentPaths()
    await fs.mkdir(path.dirname(paths.authoritative), {recursive: true})
    await fs.writeFile(paths.authoritative, Buffer.from('corrupt'))
    await writeCompressed(paths.legacy, {highScores: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]})
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual(DEFAULT_HIGH_SCORES)
    await expect(fs.readFile(paths.authoritative)).resolves.toEqual(Buffer.from('corrupt'))
  })

  it('leaves invalid legacy data untouched and does not create authoritative data', async () => {
    const paths = await useDifferentPaths()
    await writeCompressed(paths.legacy, {scores: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]})
    const originalLegacy = await fs.readFile(paths.legacy)
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual(DEFAULT_HIGH_SCORES)
    await expect(fs.readFile(paths.legacy)).resolves.toEqual(originalLegacy)
    await expect(fs.access(paths.authoritative)).rejects.toMatchObject({code: 'ENOENT'})
  })

  it('serves and preserves legacy data when its migration write fails', async () => {
    const paths = await useDifferentPaths()
    const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    await writeCompressed(paths.legacy, {highScores: scores})
    const originalLegacy = await fs.readFile(paths.legacy)
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual(scores)
    await expect(fs.readFile(paths.legacy)).resolves.toEqual(originalLegacy)
    await expect(fs.access(paths.authoritative)).rejects.toMatchObject({code: 'ENOENT'})
    await expect(fs.access(`${paths.authoritative}.tmp`)).rejects.toMatchObject({code: 'ENOENT'})
  })
})

describe('high-score validation and writes', () => {
  it('returns defaults when the authoritative file is missing', async () => {
    await useDifferentPaths()
    const {HighScoreStore} = await import('../src/main/high-scores')
    await expect(new HighScoreStore().load()).resolves.toEqual(DEFAULT_HIGH_SCORES)
  })

  it.each([
    ['corrupt compression', async (filePath: string) => fs.writeFile(filePath, Buffer.from('corrupt'))],
    ['invalid JSON', async (filePath: string) => writeCompressedJson(filePath, '{')],
    ['wrong object shape', async (filePath: string) => writeCompressed(filePath, {scores: Array(10).fill(1)})],
    ['wrong score count', async (filePath: string) => writeCompressed(filePath, {highScores: Array(9).fill(1)})],
    ['negative score', async (filePath: string) => writeCompressed(filePath, {highScores: [-1, 9, 8, 7, 6, 5, 4, 3, 2, 1]})],
    ['non-finite score', async (filePath: string) => writeCompressedJson(filePath, '{"highScores":[1e309,9,8,7,6,5,4,3,2,1]}')]
  ])('returns defaults for %s', async (_label, createInvalidFile) => {
    const paths = await useDifferentPaths()
    await fs.mkdir(path.dirname(paths.authoritative), {recursive: true})
    await createInvalidFile(paths.authoritative)
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual(DEFAULT_HIGH_SCORES)
  })

  it('normalizes finite non-negative numeric strings from stored data', async () => {
    const paths = await useDifferentPaths()
    await writeCompressed(paths.authoritative, ['1', '10', '2', '9', '3', '8', '4', '7', '5', '6'])
    const {HighScoreStore} = await import('../src/main/high-scores')

    await expect(new HighScoreStore().load()).resolves.toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('creates the first-run directory and round-trips valid scores', async () => {
    const paths = await useDifferentPaths()
    const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as HighScoreList
    const {HighScoreStore} = await import('../src/main/high-scores')

    await new HighScoreStore().save(scores)
    await expect(fs.access(paths.authoritative)).resolves.toBeUndefined()
    await expect(new HighScoreStore().load()).resolves.toEqual(scores)
  })

  it('serializes overlapping saves and preserves the last write', async () => {
    const paths = await useDifferentPaths()
    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()
    const writeFileCalls: string[] = []
    let releaseFirstWrite: (() => void) | null = null
    const originalWriteFile = fs.writeFile.bind(fs) as typeof fs.writeFile
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      writeFileCalls.push(String(args[0]))
      if (writeFileCalls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve
        })
      }
      return originalWriteFile(...args)
    })

    const firstSave = store.save([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    await waitFor(() => writeFileCalls.length === 1)
    const secondSave = store.save([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])
    const releaseWrite = releaseFirstWrite as (() => void) | null
    if (releaseWrite) releaseWrite()
    await Promise.all([firstSave, secondSave])

    expect(writeFileCalls).toHaveLength(2)
    await expect(readCompressed(paths.authoritative)).resolves.toEqual([
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11
    ])
  })

  it('preserves the last valid file when an atomic replacement fails', async () => {
    const paths = await useDifferentPaths()
    const originalScores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    await writeCompressed(paths.authoritative, originalScores)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'))
    const {HighScoreStore} = await import('../src/main/high-scores')
    const store = new HighScoreStore()

    await expect(store.save([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])).rejects.toThrow('rename failed')
    await expect(readCompressed(paths.authoritative)).resolves.toEqual(originalScores)
    await expect(fs.access(`${paths.authoritative}.tmp`)).rejects.toMatchObject({code: 'ENOENT'})
  })
})
