import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import zlib from 'zlib'
import {
  DEFAULT_HIGH_SCORES,
  normalizeHighScores,
  parseHighScores,
  type HighScoreList
} from '../electris'

const CONFIG_FILE_NAME = 'Electris.config.dat'
const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

function getHighScorePaths() {
  return {
    authoritative: path.join(app.getPath('userData'), CONFIG_FILE_NAME),
    legacy: path.join(app.getPath('appData'), 'electris', CONFIG_FILE_NAME)
  }
}

function isMissingFile(error: unknown) {
  return error !== null && typeof error === 'object' &&
    'code' in error && (error as {code: unknown}).code === 'ENOENT'
}

async function readHighScoreFile(filePath: string) {
  const compressed = await fs.readFile(filePath)
  const decoded = await inflate(compressed)
  const parsed: unknown = JSON.parse(decoded.toString('utf8'))
  const legacyShape = parsed !== null && typeof parsed === 'object' &&
      'highScores' in parsed
    ? (parsed as {highScores: unknown}).highScores
    : parsed
  const highScores = parseHighScores(legacyShape)

  if (!highScores) throw new Error('Invalid high-score data')
  return highScores
}

async function writeHighScoreFile(filePath: string, highScores: HighScoreList) {
  const directory = path.dirname(filePath)
  const tempPath = `${filePath}.tmp`
  const payload = Buffer.from(JSON.stringify(highScores))
  const compressed = await deflate(payload)

  await fs.mkdir(directory, {recursive: true})
  try {
    await fs.writeFile(tempPath, compressed)
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, {force: true}).catch(() => undefined)
    throw error
  }
}

export class HighScoreStore {
  private saveQueue: Promise<void> = Promise.resolve()

  async load(): Promise<HighScoreList> {
    const paths = getHighScorePaths()

    try {
      return await readHighScoreFile(paths.authoritative)
    } catch (error) {
      const legacyDiffers = path.resolve(paths.legacy) !==
        path.resolve(paths.authoritative)
      if (!isMissingFile(error) || !legacyDiffers) {
        return [...DEFAULT_HIGH_SCORES] as HighScoreList
      }
    }

    try {
      const legacyScores = await readHighScoreFile(paths.legacy)
      try {
        await writeHighScoreFile(paths.authoritative, legacyScores)
      } catch {
        // Keep serving the valid legacy data and leave its source untouched so a
        // later launch can retry migration without losing the user's scores.
      }
      return legacyScores
    } catch {
      return [...DEFAULT_HIGH_SCORES] as HighScoreList
    }
  }

  async save(highScores: HighScoreList): Promise<void> {
    const nextWrite = this.saveQueue.then(() =>
      writeHighScoreFile(
          getHighScorePaths().authoritative,
          normalizeHighScores(highScores)))
    this.saveQueue = nextWrite.then(() => undefined, () => undefined)
    await nextWrite
  }
}
