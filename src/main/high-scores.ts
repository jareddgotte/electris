import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import zlib from 'zlib'
import { DEFAULT_HIGH_SCORES, normalizeHighScores, type HighScoreList } from '../electris'

const CONFIG_FILE_NAME = 'Electris.config.dat'
const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

function getHighScorePath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME)
}

async function readHighScoreFile(filePath: string) {
  const compressed = await fs.readFile(filePath)
  const decoded = await inflate(compressed)
  const parsed: unknown = JSON.parse(decoded.toString('utf8'))
  const legacyShape = parsed !== null && typeof parsed === 'object' &&
      'highScores' in parsed
    ? (parsed as {highScores: unknown}).highScores
    : parsed

  return normalizeHighScores(legacyShape)
}

async function writeHighScoreFile(filePath: string, highScores: HighScoreList) {
  const directory = path.dirname(filePath)
  const tempPath = `${filePath}.tmp`
  const payload = Buffer.from(JSON.stringify(highScores))
  const compressed = await deflate(payload)

  await fs.mkdir(directory, {recursive: true})
  await fs.writeFile(tempPath, compressed)
  await fs.rename(tempPath, filePath)
}

export class HighScoreStore {
  private saveQueue: Promise<void> = Promise.resolve()

  async load(): Promise<HighScoreList> {
    try {
      return await readHighScoreFile(getHighScorePath())
    } catch {
      return [...DEFAULT_HIGH_SCORES] as HighScoreList
    }
  }

  async save(highScores: HighScoreList): Promise<void> {
    const nextWrite = this.saveQueue.then(() =>
      writeHighScoreFile(getHighScorePath(), normalizeHighScores(highScores)))
    this.saveQueue = nextWrite.then(() => undefined, () => undefined)
    await nextWrite
  }
}
