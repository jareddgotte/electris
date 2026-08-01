import { Game } from '../../src/js/game'
import { Tet } from '../../src/js/tet'

export interface PositionFixture {
  row: number
  col: number
}

export interface PieceFixture {
  type: number
  position?: PositionFixture
  rotation?: number
  pivot?: number
  shape?: number[][]
}

export interface LandedCellFixture extends PositionFixture {
  type?: number
}

export interface BoardFixture {
  activePiece?: PieceFixture
  landedCells?: LandedCellFixture[]
}

class MemoryStore {
  private values: Record<string, unknown> = {
    highScores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }

  get(key: string) {
    return this.values[key]
  }

  set(key: string, value: unknown) {
    this.values[key] = value
  }
}

export class ManualTimer {
  callbacks: Array<() => void> = []
  cleared: Array<number | undefined> = []

  setInterval(callback: () => void, _delay: number) {
    this.callbacks.push(callback)
    return this.callbacks.length
  }

  clearInterval(intervalId: number | undefined) {
    this.cleared.push(intervalId)
  }
}

function sequenceRandom(values: number[]) {
  let index = 0
  return () => {
    if (index >= values.length) {
      throw new Error('The deterministic random sequence was exhausted')
    }
    return values[index++]
  }
}

export function createGame(randomValues = [0.2, 0.4], resetBoard = true) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => null
  } as unknown as HTMLCanvasElement
  const highScoresElement = {innerHTML: ''}
  const timer = new ManualTimer()
  const game = new Game('unused-canvas', 'unused-scores', false, {
    random: sequenceRandom(randomValues),
    timer,
    canvas,
    highScoresElement,
    store: new MemoryStore(),
    bindEvents: false
  })

  if (resetBoard) {
    game.allTets = []
    game.currTet = null
    game.newTet = false
    game.updateLanded = true
  }

  return {game, canvas, highScoresElement, timer}
}

export function createPiece(game: Game, fixture: PieceFixture) {
  const tet = new Tet(game, fixture.type, () => fixture.type / 7)
  const rotation = fixture.rotation || 0
  for (let turn = 0; turn < rotation; turn++) {
    if (!tet.rotate()) throw new Error('Fixture rotation collided')
  }
  tet.topLeft = fixture.position || {row: 0, col: 4}
  tet.pivot = fixture.pivot || 0
  if (fixture.shape) tet.shape = fixture.shape.map((row) => [...row])
  return tet
}

export function createBoard(fixture: BoardFixture = {}) {
  const result = createGame()
  const activePiece = fixture.activePiece
    ? createPiece(result.game, fixture.activePiece)
    : undefined

  for (const cell of fixture.landedCells || []) {
    const fragment = createPiece(result.game, {
      type: cell.type === undefined ? 3 : cell.type,
      position: {row: cell.row, col: cell.col},
      shape: [[1]]
    })
    result.game.allTets.push(fragment)
  }

  if (activePiece) {
    result.game.currTet = activePiece
    result.game.allTets.push(activePiece)
  }
  result.game.updateLanded = true

  return {...result, activePiece}
}

/** Setup for the known issue: rotation checks the I-Tet before applying pivot. */
export const pivotedITetRegression: BoardFixture = {
  activePiece: {
    type: 0,
    position: {row: 0, col: 6},
    rotation: 0,
    pivot: 3
  },
  landedCells: [{row: 1, col: 9}]
}

export function pieceState(tet: Tet) {
  return {
    type: tet.type,
    pivot: tet.pivot,
    topLeft: {...tet.topLeft},
    shape: tet.shape.map((row) => [...row]),
    perim: tet.perim.map((point) => [...point])
  }
}
