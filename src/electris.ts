export const ELECTRIS_EXTERNAL_DESTINATIONS = ['author', 'license'] as const

export type ElectrisExternalDestination =
  (typeof ELECTRIS_EXTERNAL_DESTINATIONS)[number]

export type HighScoreList = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]

export interface ElectrisBridge {
  window: {
    minimize(): Promise<void>
    close(): Promise<void>
  }
  openExternal(destination: ElectrisExternalDestination): Promise<void>
  highScores: {
    load(): Promise<HighScoreList>
    save(highScores: HighScoreList): Promise<void>
  }
}

declare global {
  interface Window {
    electris: ElectrisBridge
  }
}

export const DEFAULT_HIGH_SCORES: HighScoreList = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0
]

function normalizeHighScoreValue(value: unknown, allowNumericStrings: boolean) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }

  if (allowNumericStrings && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }

  return null
}

export function parseHighScores(
    value: unknown,
    allowNumericStrings = true): HighScoreList | null {
  if (!Array.isArray(value) || value.length !== DEFAULT_HIGH_SCORES.length) {
    return null
  }

  const normalized = value.map((entry) =>
    normalizeHighScoreValue(entry, allowNumericStrings))
  if (normalized.some((entry) => entry === null)) return null

  return normalized
      .filter((entry): entry is number => entry !== null)
      .slice()
      .sort((left, right) => right - left) as HighScoreList
}

export function normalizeHighScores(value: unknown): HighScoreList {
  return parseHighScores(value) || [...DEFAULT_HIGH_SCORES] as HighScoreList
}
