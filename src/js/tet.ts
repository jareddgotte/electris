import { Game } from './game'
/**
 * A Tet class intended to be instantiated by "new Tet()".
 * However, upon completing a row in our Tetris game, we will want to remove the
 * blocks in that row.
 *
 * In the case that our Tet becomes divided during the row removal, we will want
 * to split the whole Tet into multiple Tet fragments which is when we will use
 * "new Tet(-1)", then set its properties manually.
 * @class Represents a Tet, both living and landed.
 */
export class Tet {
  /**
   * Initially only used to determined its shape upon our class being
   * constructed. If in range [0..6] (number of Tets), set its properties
   * appropriately. If -1, we will create a Tet with empty properties because
   * we're going to set its topLeft, shape and perimeter manually.
   */
  type: number
  /**
   * This is the number of rows we are going to move our tet when we decide to
   * rotate it. Constraints are from [0..this.pivotMax].
   */
  pivot: number
  /**
   * This is the (row, column) position the Tet is in with respect to the game
   * board (16 rows by 10 columns); (0, 0) being the most top left position.
   *
   * topLeft.row - Row position of Tet on board.
   *
   * topLeft.col - Column position of Tet on board.
   */
  topLeft: { row: number, col: number }
  /**
   * Shape of Tet, e.g. _shape = [[1,1,1,1]] is horizontal I Tetrimino where
   * [[1],[1],[1],[1]] is vertical I Tet. Number of 0 indicates empty space.
   */
  shape: number[][]
  /**
   * Perimeter of Tet, e.g. _perim = [[0,0],[0,1],[4,1],[4,0]] is horizontal
   * I Tet perimeter where [[0,0],[0,4],[1,4],[1,0]] is vertical I Tet. Imagine
   * Tetriminos being expressed as 4 "blocks," each block's side would be _s
   * pixels in magnitude, where _s is the variable blockS defined in index.php.
   * Therefore, we can determine its perimeter by taking the "(x, y) coordinates"
   * in each "row" of _perim, and multiplying each x and y value by _s.
   */
  perim: number[][]
  /** Game object which the Tet is in */
  private game: Game
  /**
   * Rotation is constrained by the range [0..3]. Incrementing the rotation
   * basically rotates the shape clockwise. This rotation decides our this.shape
   * and this.perim.
   */
  private rotation: number
  /** This is the maximum amount of times a block can be pivoted. */
  private pivotMax: number

  /**
   * @param game Game object which the Tet will be in
   * @param [type] Shape of Tet desired, determined randomly if undefined.
   */
  constructor(game: Game, type?: number) {
    // Force instantiation
    if (!(this instanceof Tet)) {
      return new Tet(game, type)
    }

    // FIXME: check if game exists
    this.game = game

    this.type = (type && type >= -1 && type < 7)
      ? type
      : Math.floor(Math.random() * 7)

    // TODO: if type is -1, then it is a single square or fragmented?
    if (this.type > -1) {
      this.rotation = 0
      this.pivot = 0
      this.topLeft = { row: 0, col: 4 }
      this.setShape(this.getShapeMatrix(0))
    }
  }

  /**
   * This method changes the rotation, if the shape can rotate properly on the
   * game board, and changes the shape and perimeter if it successfully rotates.
   * Otherwise, do nothing. We also move the Tet this.pivot blocks to the right,
   * then reset the pivot to zero.
   *
   * By default, always rotates clockwise.
   *
   * @param shape This is the shape of the Tet we care about getting the
   *     perimeter from.
   * @returns Currently, we don't care about the actual return value.
   */
  rotate() {
    const landed = this.game.getLanded()
    let potRot = this.rotation
    let potShape: number[][]
    potRot = (potRot < 3 ? potRot + 1 : 0)
    potShape = this.getShapeMatrix(potRot)
    // check for potential collisions
    const rLen = potShape.length
    for (let row = 0; row < rLen; row++) {
      const cLen = potShape[row].length
      for (let col = 0; col < cLen; col++) {
        if (potShape[row][col] !== 0) {
          if (col + this.topLeft.col < 0) {
            // console.log('left beyond playing field')
            return false
          }
          if (col + this.topLeft.col >= Game.BOARD_COL_NUM) {
            // console.log('right beyond playing field')
            return false
          }
          if (row + this.topLeft.row >= Game.BOARD_ROW_NUM) {
            // console.log('below playing field')
            return false
          }
          if (landed[row + this.topLeft.row][col + this.topLeft.col] !== 0) {
            // console.log('rotate: space is taken')
            return false
          }
        }
      }
    }
    this.topLeft.col += this.pivot
    this.pivot = 0
    this.rotation = potRot
    this.setShape(potShape)
    return true
  }

  /**
   * This method checks to see if the pivot shape shadow can display properly.
   * @returns This returns the perimeter matrix given by the getPerim()
   *     method.
   */
  doesNotTetPivotCollide() {
    let potRot = this.rotation
    const potTopLeft = {
      row: this.topLeft.row,
      col: this.topLeft.col + this.pivot
    }
    let potShape: number[][]
    const landed = this.game.getLanded(this)
    potRot = potRot < 3 ? potRot + 1 : 0
    potShape = this.getShapeMatrix(potRot)
    const rLen = potShape.length
    for (let row = 0; row < rLen; row++) {
      const cLen = potShape[row].length
      for (let col = 0; col < cLen; col++) {
        if (potShape[row][col] !== 0) {
          if (row + potTopLeft.row >= Game.BOARD_ROW_NUM) {
            // console.log('below playing field')
            return false
          }
          if (landed[row + potTopLeft.row][col + potTopLeft.col] !== 0) {
            // console.log('bot: space taken')
            return false
          }
          if (col + potTopLeft.col < 0) {
            // console.log('left beyond playing field')
            return false
          }
          if (col + potTopLeft.col >= Game.BOARD_COL_NUM) {
            // console.log('right beyond playing field')
            return false
          }
          if (landed[row + potTopLeft.row][col + potTopLeft.col] !== 0) {
            // console.log('side: space taken')
            return false
          }
        }
      }
    }
    return this.getPerim(potShape)
  }

  /**
   * This method checks to see if a Tet will collide with the bottom of the game
   * board or another Tet.
   * @param potTopLeft This object contains a potential row and column
   *     which we use to check to see if the Tet will collide if it moves to the
   *     coordinate specified by this param.
   * @returns If Tet colides, return true; else, false.
   */
  doesTetCollideBot(potTopLeft: { row: number, col: number }) {
    const landed = this.game.getLanded(this)
    const rLen = this.shape.length
    for (let row = 0; row < rLen; row++) {
      const cLen = this.shape[row].length
      for (let col = 0; col < cLen; col++) {
        if (this.shape[row][col] !== 0) {
          if (row + potTopLeft.row >= Game.BOARD_ROW_NUM) {
            // console.log('below playing field')
            return true
          }
          if (landed[row + potTopLeft.row][col + potTopLeft.col] !== 0) {
            // console.log('bot: space taken')
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * This method moves the Tet left by 1 column if it does not collide with the
   * side of the game board or another Tet. This method also resets the pivot to
   * zero.
   */
  moveLeft() {
    this.pivot = 0
    const potTopLeft = {
      row: this.topLeft.row,
      col: this.topLeft.col - 1
    }
    if (!this.doesTetCollideSide(potTopLeft)) {
      this.topLeft = potTopLeft
    }
  }

  /**
   * This method moves the Tet right by 1 column if it does not collide with the
   * side of the game board or another Tet.
   */
  moveRight() {
    const potTopLeft = {
      row: this.topLeft.row,
      col: this.topLeft.col + 1
    }
    if (!this.doesTetCollideSide(potTopLeft, 1)) {
      this.topLeft = potTopLeft
    }
  }

  /**
   * This method moves the Tet down by 1 column if it does not collide with the
   * side of the game board or another Tet. If it does collide, the Tet lands,
   * we create another Tet, and we perform the collided method to handle row
   * elimination and Tet fragmentation.
   */
  moveDown() {
    const potTopLeft = {
      row: this.topLeft.row + 1,
      col: this.topLeft.col
    }
    if (!this.doesTetCollideBot(potTopLeft)) {
      this.topLeft = potTopLeft
    } else {
      this.game.newTet = true
      this.game.currTet = null
      this.game.updateLanded = true
      this.collided()
    }
  }

  /**
   * This method sets each row within its shape to zero for each row marked as
   * full.
   * @param fullRows This is an array of all of the rows that were marked as
   *     full in the collided method above.
   */
  alterShape(fullRows: number[]) {
    const len = fullRows.length
    let row: number
    for (let i = 0; i < len; i++) {
      row = fullRows[i] - this.topLeft.row
      if (row < 0 || row > this.shape.length - 1) {
        continue
      }
      const cLen = this.shape[row].length
      for (let col = 0; col < cLen; col++) {
        this.shape[row][col] = 0
      }
    }
    this.updateTet()
  }

  /**
   * This method takes in a Tet type and rotation then outputs its shape matrix.
   * This method is only needed on a live Tet. I.e. if a Tet is already placed
   * on the landed array, this method will not be used.
   * @param rotation Rotation of shape, determined by user input.
   * @returns Number matrix of shape. If type is unexpected, return empty array.
   */
  private getShapeMatrix(rotation: number) {
    // Shapes are from: http://en.wikipedia.org/wiki/Tetris#Colors_of_Tetriminos
    // The numbers in these arrays denote their eventual color.
    // NOTE: Trailing zeros were removed and replaced by spaces in the following
    // matrices as a reasonable optimization for gaming (preventing unnecessary
    // loop iterations).
    /* tslint:disable:no-multi-spaces */
    const matrixMatrix = [
      // I
      [
        [[1, 1, 1, 1]], [[1], [1], [1], [1]]
      ],
      // J
      [
        [[1, 1, 1], [0, 0, 1]], [[0, 1], [0, 1], [1, 1]],
        [[1], [1, 1, 1]], [[1, 1], [1], [1]]
      ],
      // L
      [
        [[1, 1, 1], [1]], [[1, 1], [0, 1], [0, 1]],
        [[0, 0, 1], [1, 1, 1]], [[1], [1], [1, 1]]
      ],
      // O
      [
        [[1, 1], [1, 1]]
      ],
      // S
      [
        [[0, 1, 1], [1, 1]], [[1], [1, 1], [0, 1]]
      ],
      // T
      [
        [[1, 1, 1], [0, 1]], [[0, 1], [1, 1], [0, 1]],
        [[0, 1], [1, 1, 1]], [[1], [1, 1], [1]]
      ],
      // Z
      [
        [[1, 1], [0, 1, 1]], [[0, 1], [1, 1], [1]]
      ]
    ]
    /* tslint:enable:no-multi-spaces */
    const m = matrixMatrix[this.type]
    switch (this.type) {
      case 0: // I needs 3 pivots
        this.pivotMax = 3
        break
      case 3: // O needs no pivots
        this.pivotMax = 0
        break
      default: // every other Tet needs 1
        this.pivotMax = 1
    }
    switch (m.length) {
      case 1:
        return m[0]
      case 2:
        return m[rotation % 2]
      case 4:
        return m[rotation]
      default:
        // console.log('unexpected array length in function ' +
        //     arguments.callee.toString().substr(
        //         9, arguments.callee.toString().indexOf('(') - 9))
        return []
    }
  }

  /**
   * This method is used any time a living/landed Tet's shape is
   * created/altered. Upon breaking up a tet, make sure these conditions are met
   * on its new shape:
   *
   * 1) Remove trailing zeros from each row, e.g. [1,0] becomes [1];
   *
   * 2) If new shape is one row, remove leading zeros, e.g. [0,1] becomes [1].
   *    Which they are in the Tet.cleanShape() method.
   *
   * @param shape This is the shape of the Tet we care about getting the
   *     perimeter from.
   * @returns Perimeter of shape. If shape is unknown, return empty array.
   */
  private getPerim(shape: number[][]) {
    // NOTE: Trailing zeros were removed and replaced by spaces in the following
    // matrices as a gaming optimization (preventing unnecessary loop
    // iterations).
    /* tslint:disable:no-multi-spaces */
    const periMatrix = [
      // fragments
      [[[1]], [[0, 0], [0, 1], [1, 1], [1, 0]]],
      [[[1, 1]], [[0, 0], [0, 1], [2, 1], [2, 0]]],
      [[[1], [1]], [[0, 0], [0, 2], [1, 2], [1, 0]]],
      [[[1, 1, 1]], [[0, 0], [0, 1], [3, 1], [3, 0]]],
      [[[1], [1], [1]], [[0, 0], [0, 3], [1, 3], [1, 0]]],
      [[[1, 1], [0, 1]], [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 0]]],
      [[[0, 1], [1, 1]], [[1, 0], [1, 1], [0, 1], [0, 2], [2, 2], [2, 0]]],
      [[[1], [1, 1]], [[0, 0], [0, 2], [2, 2], [2, 1], [1, 1], [1, 0]]],
      [[[1, 1], [1]], [[0, 0], [0, 2], [1, 2], [1, 1], [2, 1], [2, 0]]],
      // I
      [[[1, 1, 1, 1]], [[0, 0], [0, 1], [4, 1], [4, 0]]],
      [[[1], [1], [1], [1]], [[0, 0], [0, 4], [1, 4], [1, 0]]],
      // J
      [[[1, 1, 1], [0, 0, 1]], [[0, 0], [0, 1], [2, 1], [2, 2], [3, 2], [3, 0]]],
      [[[0, 1], [0, 1], [1, 1]], [[1, 0], [1, 2], [0, 2], [0, 3], [2, 3], [2, 0]]],
      [[[1], [1, 1, 1]], [[0, 0], [0, 2], [3, 2], [3, 1], [1, 1], [1, 0]]],
      [[[1, 1], [1], [1]], [[0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 0]]],
      // L
      [[[1, 1, 1], [1]], [[0, 0], [0, 2], [1, 2], [1, 1], [3, 1], [3, 0]]],
      [[[1, 1], [0, 1], [0, 1]], [[0, 0], [0, 1], [1, 1], [1, 3], [2, 3], [2, 0]]],
      [[[0, 0, 1], [1, 1, 1]], [[2, 0], [2, 1], [0, 1], [0, 2], [3, 2], [3, 0]]],
      [[[1], [1], [1, 1]], [[0, 0], [0, 3], [2, 3], [2, 2], [1, 2], [1, 0]]],
      // O
      [[[1, 1], [1, 1]], [[0, 0], [0, 2], [2, 2], [2, 0]]],
      // S
      [[[0, 1, 1], [1, 1]], [[1, 0], [1, 1], [0, 1], [0, 2], [2, 2], [2, 1], [3, 1], [3, 0]]],
      [[[1], [1, 1], [0, 1]], [[0, 0], [0, 2], [1, 2], [1, 3], [2, 3], [2, 1], [1, 1], [1, 0]]],
      // T
      [[[1, 1, 1], [0, 1]], [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1], [3, 1], [3, 0]]],
      [[[0, 1], [1, 1], [0, 1]], [[1, 0], [1, 1], [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 0]]],
      [[[0, 1], [1, 1, 1]], [[1, 0], [1, 1], [0, 1], [0, 2], [3, 2], [3, 1], [2, 1], [2, 0]]],
      [[[1], [1, 1], [1]], [[0, 0], [0, 3], [1, 3], [1, 2], [2, 2], [2, 1], [1, 1], [1, 0]]],
      // Z
      [[[1, 1], [0, 1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2], [3, 2], [3, 1], [2, 1], [2, 0]]],
      [[[0, 1], [1, 1], [1]], [[1, 0], [1, 1], [0, 1], [0, 3], [1, 3], [1, 2], [2, 2], [2, 0]]]
    ]
    /* tslint:enable:no-multi-spaces */
    let checkNextShape: boolean
    // Iterate through periMatrix to see if the given shape matches a shape
    // within this array
    const pLen = periMatrix.length
    for (let pRow = 0; pRow < pLen; pRow++) {
      checkNextShape = false
      const rLen = shape.length
      for (let row = 0; row < rLen; row++) {
        if (rLen !== periMatrix[pRow][0].length) {
          checkNextShape = true
          break
        }
        if (checkNextShape) break
        const cLen = shape[row].length
        for (let col = 0; col < cLen; col++) {
          if (shape[row].length !== periMatrix[pRow][0][row].length) {
            checkNextShape = true
            break
          }
          if (shape[row][col] === periMatrix[pRow][0][row][col]) {
            continue
          }
          checkNextShape = true
          break
        }
      }
      if (!checkNextShape) {
        // if it gets to this point, we found our point array
        return periMatrix[pRow][1]
      }
    }
    return []
  }

  /**
   * This method actually sets the shape and perimeter of the Tet that's
   * executing this method.
   * @param shape This is the shape of the Tet we care about getting the
   *     perimeter from.
   */
  private setShape(shape: number[][]) {
    this.shape = shape
    this.perim = this.getPerim(shape)
  }

  /**
   * This method checks to see if a Tet will collide with the side of the game
   * board or another Tet. If it collides on the right side of the Tet, we'll
   * adjust the pivot as necessary.
   * @param potTopLeft This object contains a potential row and column
   *     which we use to check to see if the Tet will collide if it moves to the
   *     coordinate specified by this param.
   * @param [direction] If value is 1, we are testing the right side
   *     and we're going to adjust the pivot.
   * @returns If Tet colides, return true; else, false.
   */
  private doesTetCollideSide(
    potTopLeft: { row: number, col: number },
    direction?: number) {
    const landed = this.game.getLanded()
    const rLen = this.shape.length
    for (let row = 0; row < rLen; row++) {
      const cLen = this.shape[row].length
      for (let col = 0; col < cLen; col++) {
        if (this.shape[row][col] !== 0) {
          if (col + potTopLeft.col < 0) {
            // console.log('left beyond playing field');
            return true
          }
          if (col + potTopLeft.col >= Game.BOARD_COL_NUM) {
            // console.log('right beyond playing field');
            if (this.pivot < this.pivotMax && this.rotation % 2 === 0) {
              this.pivot++
            }
            return true
          }
          if (landed[row + potTopLeft.row][col + potTopLeft.col] !== 0) {
            // console.log('side: space taken');
            if (direction === 1 &&
              (this.pivot < this.pivotMax && this.rotation % 2 === 0)) {
              this.pivot++
            }
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * This method handles row elimination and Tet fragmentation. We also adjust
   * the score depending on how many rows get eliminated. The score scales with
   * how many rows get eliminated at once by the following formula:
   *
   * `score += (fRLen ** (1 + (fRLen - 1) * 0.1)) * 10000`
   *
   * We then perform the falling animations on the Tets affected by "gravity."
   */
  private collided() {
    const landed = this.game.getLanded()
    let isFilled: boolean
    const fullRows = []
    // Find the rows we're going to eliminate
    for (let row = this.topLeft.row; row < Game.BOARD_ROW_NUM; row++) {
      isFilled = true
      for (let col = 0; col < Game.BOARD_COL_NUM; col++) {
        if (landed[row][col] === 0) {
          isFilled = false
        }
      }
      if (isFilled) fullRows.push(row)
    }
    this.game.updateLanded = true
    const fRLen = fullRows.length
    if (fRLen === 0) return
    // Adjust score (Scale the point rewarded for filling rows to benefit those
    // that break more at one time.)
    this.game.score += (fRLen ** (1 + (fRLen - 1) * 0.1)) * 10000
    // Alter the shapes
    this.game.alterShapes(fullRows)
    this.game.updateLanded = true
    // Perform falling animations
    const that = this
    // let movingTets = [0] // TODO: why is this 0?
    let movingTets = []
    let tetsMoved: boolean
    const moveLoop = window.setInterval(() => {
      movingTets = []
      tetsMoved = true
      while (tetsMoved) {
        tetsMoved = false
        const aT = that.game.allTets
        const tLen = aT.length
        for (let tet = 0; tet < tLen; tet++) {
          if (movingTets.indexOf(aT[tet], 0) > -1 ||
            (aT[tet] === that.game.currTet && that.game.newTet !== true)) {
            continue
          }
          const potTL = {
            row: aT[tet].topLeft.row + 1,
            col: aT[tet].topLeft.col
          }
          if (!aT[tet].doesTetCollideBot(potTL)) {
            aT[tet].topLeft = potTL
            movingTets.push(aT[tet])
            tetsMoved = true
          }
        }
        that.game.updateLanded = true
      }
      that.game.draw()
      if (movingTets.length === 0) {
        clearInterval(moveLoop)
        that.collided()
      }
    }, 200)
  }

  /**
   * This method cleans up a Tet or Tet fragment, after being affected the by
   * collided method which affects the shape of Tets located in the rows being
   * eliminated. By cleaning, we mean removing extraneous zeros from their shape
   * matrix as well as adjusting their topLeft property. We clean them so that
   * we can match its shape against a known Tet/fragment so we can determine its
   * perimeter.
   * @param o This is a object which holds a shape and a topLeft property.
   * @returns This is the cleaned up shape, without extraneous zeros, and
   *     adjusted topLeft.
   */
  private cleanShape(o: TetRep): TetRep {
    const shape = o.shape
    const topLeft = o.topLeft
    let done = false
    // If there exists columns of all zeros on the far left, remove all those
    // columns
    while (true) {
      const len = shape.length
      for (let row = 0; row < len; row++) {
        if (shape[row][0] > 0) {
          done = true
          break
        }
      }
      if (done) break
      for (let row = 0; row < len; row++) {
        shape[row].splice(0, 1)
      }
      // Adjust topLeft if necessary
      topLeft.col += 1
    }
    // If there exists zeros at the end of each row array, remove those zeros
    const len = shape.length
    for (let row = 0; row < len; row++) {
      for (let col = shape[row].length - 1; col >= 0; col--) {
        if (shape[row][col] === 0) {
          shape[row].splice(col, 1)
          continue
        }
        break
      }
    }
    return { shape: shape, topLeft: topLeft }
  }

  /**
   * This method checks to see if itself, an array, is all zeros.
   * @returns If itself is all zeros, return true; else, false.
   */
  private arrayIsAllZeros(arr: number[]) {
    const len = arr.length
    for (let col = 0; col < len; col++) {
      if (arr[col] > 0) return false
    }
    return true
  }

  /**
   * This method parses its own shape to determine if it needs to fragment or
   * not. If it becomes fragmented, we instantiate a new Tet class to add in its
   * fragmented part.
   */
  private updateTet() {
    const q: TetRep[] = []
    let currShape: number[][] = []
    let topLeft = this.topLeft
    // Iterate through the altered shape to build multiple fragments if
    // necessary
    const len = this.shape.length
    for (let row = 0; row < len; row++) {
      // If we do not come across a row with all zeros, continue building our
      // shape
      if (!this.arrayIsAllZeros(this.shape[row])) {
        if (currShape.length === 0) {
          topLeft = { row: this.topLeft.row + row, col: this.topLeft.col }
        }
        currShape.push(this.shape[row])
        // FIXME: Otherwise, push this current shape onto the queue and reset our
        // temporary shape to potentially build another
      } else {
        if (currShape.length === 0) continue
        q.push({ shape: currShape, topLeft: topLeft })
        currShape = []
      }
    }

    if (currShape.length > 0) q.push({ shape: currShape, topLeft: topLeft })

    if (q.length === 0) {
      // Remove this Tet from allTets if shape is a zero'd matrix (Tet
      // completely gone)
      this.game.tetsToRemove.push(this.game.allTets.indexOf(this))
    }

    // Iterate through our queue
    const len2 = q.length
    for (let i = 0; i < len2; i++) {
      const tmp = this.cleanShape(q[i])
      // For the first object in the queue, keep our current Tet and just set
      // the shape
      if (i === 0) {
        this.topLeft = tmp.topLeft
        this.setShape(tmp.shape)
        // For all other objects in the queue, create a new Tet class and set its
        // shape, then push this new Tet onto the allTets Game class property
      } else {
        const newTet = new Tet(this.game, -1)
        newTet.type = this.type
        newTet.topLeft = tmp.topLeft
        newTet.setShape(tmp.shape)
        this.game.allTets.push(newTet)
      }
    }
  }
}