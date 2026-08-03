import { describe, expect, it } from 'vitest'
import { Game } from '../src/js/game'
import { Tet } from '../src/js/tet'
import {
  createBoard,
  createGame,
  createPiece,
  legalPivotedITet,
  pieceState,
  pivotedITetRegression
} from './fixtures/game'

const shapeRotations: Array<{name: string, type: number, shapes: number[][][]}> = [
  {
    name: 'I',
    type: 0,
    shapes: [
      [[1, 1, 1, 1]],
      [[1], [1], [1], [1]]
    ]
  },
  {
    name: 'J',
    type: 1,
    shapes: [
      [[1, 1, 1], [0, 0, 1]],
      [[0, 1], [0, 1], [1, 1]],
      [[1], [1, 1, 1]],
      [[1, 1], [1], [1]]
    ]
  },
  {
    name: 'L',
    type: 2,
    shapes: [
      [[1, 1, 1], [1]],
      [[1, 1], [0, 1], [0, 1]],
      [[0, 0, 1], [1, 1, 1]],
      [[1], [1], [1, 1]]
    ]
  },
  {
    name: 'O',
    type: 3,
    shapes: [
      [[1, 1], [1, 1]]
    ]
  },
  {
    name: 'S',
    type: 4,
    shapes: [
      [[0, 1, 1], [1, 1]],
      [[1], [1, 1], [0, 1]]
    ]
  },
  {
    name: 'T',
    type: 5,
    shapes: [
      [[1, 1, 1], [0, 1]],
      [[0, 1], [1, 1], [0, 1]],
      [[0, 1], [1, 1, 1]],
      [[1], [1, 1], [1]]
    ]
  },
  {
    name: 'Z',
    type: 6,
    shapes: [
      [[1, 1], [0, 1, 1]],
      [[0, 1], [1, 1], [1]]
    ]
  }
]

describe('piece construction', () => {
  it.each([-1, 0, 1, 2, 3, 4, 5, 6])(
      'preserves supported explicit type %s', (type) => {
        const {game} = createGame()
        const tet = new Tet(game, type, () => 0.8)

        expect(tet.type).toBe(type)
        if (type === 0) expect(tet.shape).toEqual([[1, 1, 1, 1]])
      })

  it.each([
    ['absent', undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['fraction', 1.5],
    ['below range', -2],
    ['above range', 7]
  ])('randomizes %s input with the controlled source', (_name, type) => {
    const {game} = createGame()
    const tet = new Tet(game, type, () => 0.8)

    expect(tet.type).toBe(5)
    expect(tet.shape).toEqual([[1, 1, 1], [0, 1]])
  })

  it('keeps a selected first I-Tet without bypassing the S/Z exclusion', () => {
    const {game} = createGame([0, 4 / 7], false)

    expect(game.currTet?.type).toBe(0)
    expect(game.currTet?.shape).toEqual([[1, 1, 1, 1]])
    expect(game.nextTet?.type).toBe(4)
  })
})

describe('piece shape and rotation mapping', () => {
  for (const fixture of shapeRotations) {
    it(`maps every ${fixture.name}-Tet rotation to its production shape`, () => {
      const {activePiece} = createBoard({activePiece: {type: fixture.type}})
      if (!activePiece) throw new Error('Expected an active piece')

      for (let turn = 0; turn < 4; turn++) {
        expect(activePiece.shape).toEqual(
            fixture.shapes[turn % fixture.shapes.length])
        expect(activePiece.rotate()).toBe(true)
      }
    })
  }
})

describe('movement and collision', () => {
  it('moves left, right, and down by one board cell', () => {
    const {activePiece} = createBoard({
      activePiece: {type: 3, position: {row: 3, col: 4}}
    })
    if (!activePiece) throw new Error('Expected an active piece')

    activePiece.moveLeft()
    expect(activePiece.topLeft).toEqual({row: 3, col: 3})
    activePiece.moveRight()
    expect(activePiece.topLeft).toEqual({row: 3, col: 4})
    activePiece.moveDown()
    expect(activePiece.topLeft).toEqual({row: 4, col: 4})
  })

  it('leaves a piece unchanged after rejected wall moves', () => {
    const left = createBoard({
      activePiece: {type: 3, position: {row: 2, col: 0}}
    }).activePiece
    if (!left) throw new Error('Expected an active piece')
    const beforeLeft = pieceState(left)
    left.moveLeft()
    expect(pieceState(left)).toEqual(beforeLeft)

    const right = createBoard({
      activePiece: {type: 0, position: {row: 2, col: 9}, rotation: 1}
    }).activePiece
    if (!right) throw new Error('Expected an active piece')
    const beforeRight = pieceState(right)
    right.moveRight()
    expect(pieceState(right)).toEqual(beforeRight)
  })

  it('rejects a move into a landed cell without changing the piece', () => {
    const {activePiece} = createBoard({
      activePiece: {type: 3, position: {row: 4, col: 3}},
      landedCells: [{row: 4, col: 2}]
    })
    if (!activePiece) throw new Error('Expected an active piece')
    const before = pieceState(activePiece)

    activePiece.moveLeft()

    expect(pieceState(activePiece)).toEqual(before)
  })

  it('detects bottom and landed-cell collisions without mutating the piece', () => {
    const bottom = createBoard({
      activePiece: {type: 3, position: {row: 14, col: 4}}
    }).activePiece
    if (!bottom) throw new Error('Expected an active piece')
    const beforeBottom = pieceState(bottom)
    expect(bottom.doesTetCollideBot({row: 15, col: 4})).toBe(true)
    expect(pieceState(bottom)).toEqual(beforeBottom)

    const blocked = createBoard({
      activePiece: {type: 3, position: {row: 4, col: 4}},
      landedCells: [{row: 6, col: 4}]
    }).activePiece
    if (!blocked) throw new Error('Expected an active piece')
    const beforeBlocked = pieceState(blocked)
    expect(blocked.doesTetCollideBot({row: 5, col: 4})).toBe(true)
    expect(pieceState(blocked)).toEqual(beforeBlocked)
  })
})

describe('rotation collision', () => {
  it('applies an ordinary clockwise rotation in open space', () => {
    const {activePiece} = createBoard({
      activePiece: {type: 5, position: {row: 4, col: 3}}
    })
    if (!activePiece) throw new Error('Expected an active piece')

    expect(activePiece.rotate()).toBe(true)
    expect(activePiece.topLeft).toEqual({row: 4, col: 3})
    expect(activePiece.shape).toEqual([[0, 1], [1, 1], [0, 1]])
  })

  it('rejects an occupied rotation and leaves all observable state unchanged', () => {
    const {activePiece} = createBoard({
      activePiece: {type: 5, position: {row: 4, col: 3}},
      landedCells: [{row: 6, col: 4}]
    })
    if (!activePiece) throw new Error('Expected an active piece')
    const before = pieceState(activePiece)

    expect(activePiece.rotate()).toBe(false)
    expect(pieceState(activePiece)).toEqual(before)
  })

  it('rejects a pivoted I-Tet rotation at its occupied destination', () => {
    const {game, activePiece} = createBoard(pivotedITetRegression)
    if (!activePiece) throw new Error('Expected an active piece')
    const before = pieceState(activePiece)

    expect(activePiece.pivot).toBe(3)
    expect(game.getLanded()[1][9]).toBe(1)
    expect(activePiece.rotate()).toBe(false)
    expect(pieceState(activePiece)).toEqual(before)
  })

  it('commits a legal pivoted I-Tet destination and resets the pivot', () => {
    const {activePiece} = createBoard(legalPivotedITet)
    if (!activePiece) throw new Error('Expected an active piece')

    expect(activePiece.pivot).toBe(3)
    expect(activePiece.rotate()).toBe(true)
    expect(activePiece.topLeft).toEqual({row: 0, col: 9})
    expect(activePiece.shape).toEqual([[1], [1], [1], [1]])
    expect(activePiece.pivot).toBe(0)
  })
})

describe('landed board mapping', () => {
  it('maps occupied shape cells to board rows and columns', () => {
    const {game} = createGame()
    const landed = createPiece(game, {
      type: 2,
      position: {row: 10, col: 2},
      rotation: 1
    })
    game.allTets.push(landed)
    game.updateLanded = true

    const board = game.getLanded()
    expect(board[10].slice(2, 4)).toEqual([1, 1])
    expect(board[11].slice(2, 4)).toEqual([0, 1])
    expect(board[12].slice(2, 4)).toEqual([0, 1])
    expect(board.flat().filter((cell) => cell === 1)).toHaveLength(4)
  })

  it('excludes the active piece while retaining landed cells', () => {
    const {game} = createBoard({
      activePiece: {type: 3, position: {row: 5, col: 4}},
      landedCells: [{row: 9, col: 1}]
    })

    const board = game.getLanded()
    expect(board[5][4]).toBe(0)
    expect(board[5][5]).toBe(0)
    expect(board[6][4]).toBe(0)
    expect(board[6][5]).toBe(0)
    expect(board[9][1]).toBe(1)
  })
})

describe('runtime dependency seams', () => {
  it('uses deterministic randomness, in-memory UI/storage, and manual timers', () => {
    const {game, canvas, highScoresElement, timer} =
        createGame([0.2, 0.4], false)

    expect(game.currTet?.type).toBe(1)
    expect(game.nextTet?.type).toBe(2)
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(400)
    expect(highScoresElement.innerHTML).toContain('<li>0</li>')

    game.tetDownLoop()
    expect(timer.callbacks).toHaveLength(1)
    expect(game.loop).toBe(1)
    timer.callbacks[0]()
    expect(timer.callbacks).toHaveLength(1)
  })

  it('sorts valid but unsorted high scores before inserting a new one', () => {
    const {game} = createGame()
    game.setHighScores([0, 0, 0, 0, 0, 0, 0, 0, 0, 100])
    game.score = 50

    expect(game.checkHighScore()).toEqual([100, 50, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('retains the standard board dimensions', () => {
    expect(Game.BOARD_ROW_NUM).toBe(16)
    expect(Game.BOARD_COL_NUM).toBe(10)
  })
})
