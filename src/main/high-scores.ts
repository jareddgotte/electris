import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import zlib from 'zlib'
import { DEFAULT_HIGH_SCORES, normalizeHighScores, type HighScoreList } from '../electris'

const CONFIG_FILE_NAME = 'Electris.config.dat'
const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

export function createHighScorePaths() {
  const userDataPath = path.join(app.getPath('userData'), CONFIG_FILE_NAME)
  const legacyPath = path.join(app.getPath('appData'), 'electris', CONFIG_FILE_NAME)

  return {legacyPath, userDataPath}
}

async function readHighScoreFile(filePath: string) {
  const compressed = await fs.readFile(filePath)
  const decoded = await inflate(compressed)
  return normalizeHighScores(JSON.parse(decoded.toString('utf8')))
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
  constructor(private readonly paths = createHighScorePaths()) {}

  async load(): Promise<HighScoreList> {
    try {
      return await readHighScoreFile(this.paths.userDataPath)
    } catch {
      if (this.paths.legacyPath === this.paths.userDataPath) {
        return [...DEFAULT_HIGH_SCORES] as HighScoreList
      }
    }

    try {
      const legacyScores = await readHighScoreFile(this.paths.legacyPath)
      await this.save(legacyScores)
      return legacyScores
    } catch {
      return [...DEFAULT_HIGH_SCORES] as HighScoreList
    }
  }

  async save(highScores: HighScoreList): Promise<void> {
    await writeHighScoreFile(this.paths.userDataPath, normalizeHighScores(highScores))
  }
}
