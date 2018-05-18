/**
 * @author Jared Gotte
 */

// The collision detection is mostly inspired from the article:
// http://gamedev.tutsplus.com/tutorials/implementation/implementing-tetris-collision-detection/
// (by Michael James Williams on Oct 6th 2012).
// The reason why I did not entirely come up with my own algorithms for
// everything is for the sake of time.

// Most of the standards I used for Tetris came from
// http://en.wikipedia.org/wiki/Tetris

/* Nomenclature:
 *
 * user:       Person playing the game.
 * Tet:        Short for Tetrimino (http://en.wikipedia.org/wiki/Tetrimino), or
 *             the name of our main class. I will try to disambiguate within the
 *             comments when necessary.
 * living Tet: Tet in free fall controlled by user.
 * landed Tet: Tet that has landed and is no longer in control by user.
 */

/** Represents our game board and interface */
class Game {
  // Public Vars
  /** Developer Mode (when enabled/true, test cases can be ran via keybinds) */
  devModeOn: boolean
  /**
   * Since the Tetris standard is to have 10 horizontal blocks by 16 vertical
   * blocks, this is a constant set to 16.
   */
  static readonly BOARD_ROW_NUM: number = 16
  /**
   * Since the Tetris standard is to have 10 horizontal blocks by 16 vertical
   * blocks, this is a constant set to 10.
   */
  static readonly BOARD_COL_NUM: number = 10
  /**
   * If true, we want to create a new Tet at the beginning of the loop
   * interval.
   * 
   * Defaults as true since we always want to create a new Tet at the beginning
   * of the game.
   */
  newTet: boolean
  /**
   * The Tet that's falling and being controlled by the player.
   * 
   * Defaults as null since we don't start off with any Tets the moment the game
   * gets intialized.
   */
  currTet: Tet | null
  /**
   * The Tet that's going to come into play after the currTet lands.
   * 
   * Defaults as null since we don't start off with any Tets the moment the game
   * gets intialized.
   */
  nextTet: Tet | null
  /**
   * If true, we should update our landed array to be used in collision
   * detection.
   */
  updateLanded: boolean
  /** This is the array of all Tets that are in the game. */
  allTets: Tet[]
  /**
   * This is the array of all Tets that need to be removed before being drawn.
   */
  tetsToRemove: number[]
  /** This is the score that we're going to use to display. */
  score: number
  /**
   * This is the boolean we check to see if we should update our high score list
   * or not.
   */
  updateScore: boolean
  /** TODO: Add comment */
  loop: NodeJS.Timer
  /** TODO: Add comment */
  dropOnce: boolean

  // Private vars
  /**
   * This is the interval, in milliseconds, for which our currTet is going to
   * drop 1 block.
   */
  private dropInterval: number
  /**
   * The flag that indicates when the game is over. When true, we handle the
   * "game over" events.
   */
  private gameOver: boolean
  /**
   * This is the width that we set. This width can be adjusted and our game will
   * scale to it.
   */
  private canvasWidth: number
  /** This is the length of the side of each "block" on the game, in pixels. */
  private blockS: number
  /** This is the DOM element for which we are going to be drawing on. */
  private canvas: HTMLCanvasElement
  /**
   * This is the height of the panel which houses our score, nextTet, and
   * PAUSED/DEV text.
   */
  private panelHeight: number
  /**
   * This is the array of array of numbers which we are going to populate with
   * our allTets to be able to detect Tet collision.
   */
  private landed: number[][]
  /** TODO: Add comment */
  private paused: boolean
  /**
   * This is the name of the high score list DOM element for which we are going
   * to show our user their past high scores.
   */
  private highScoresListId: string

  /**
   * Represents all of the functions which generate and control the game board.
   * We use the {@link Tet} class to manipulate our Tets.
   * @param canvasId This is the id of the canvas element within the document
   *     from which this Game class was created.
   * @param highScoresListId This is the id of the list for which we are going
   *     to list out the user's past high scores.
   * @param [devMode] This is the option to set the game to be initially in
   *     Developer's Mode.
   */
  constructor(canvasId: string, highScoresListId: string, devModeOn = false) {
    // Force instantiation
    if (!(this instanceof Game)) {
      return new Game(canvasId, highScoresListId, devModeOn)
    }

    // TODO: Add ability to pass in {options}
    this.devModeOn = devModeOn
    this.newTet = true
    this.currTet = null
    this.nextTet = null
    this.updateLanded = true
    this.allTets = []
    this.tetsToRemove = []
    this.score = 0
    this.updateScore = true

    // Private vars
    this.dropInterval = 750 // 750
    this.gameOver = false
    this.canvasWidth = 200

    // Assume block width and height will always be the same:
    this.blockS = this.canvasWidth / 10

    this.canvas = <HTMLCanvasElement> document.getElementById(canvasId)
    this.canvas.width = this.canvasWidth
    this.canvas.height = 2 * this.canvasWidth

    this.panelHeight = 
        Math.round((2 - Game.BOARD_ROW_NUM / Game.BOARD_COL_NUM) *
            this.canvasWidth)

    this.landed = []
    this.paused = true
    this.highScoresListId = highScoresListId

    // Init functions
    this.displayHighScores()
    this.createTet()
    this.handleEvents()
  }

  /**
   * This method creates 3 event listeners (2 for the window and 1 for the
   * document). The 2 events for the window are onblur and onfocus. These will
   * pause the game when you leave the game window and resume it when you come
   * back. The event for the document listens for onkeydown events. These
   * basically allow the user to interact with the game.
   */
  handleEvents() {
    const that = this
    // Pause if we lose focus of the game. Resume once we get focus back. We
    // don't need the Page Visibility API because we don't have a resource
    // intensive game while it's idle
    let pausedBeforeBlur = true
    window.onblur = () => {
      if (that.gameOver === false) {
        pausedBeforeBlur = that.paused
        clearInterval(that.loop)
        that.paused = true
        that.draw()
      }
    }
    window.onfocus = () => {
      if (!pausedBeforeBlur && that.gameOver === false) {
        if (!that.gameOver) {
          that.tetDownLoop()
        }
        that.paused = false
        that.draw()
      }
    }
  
    // Handle key events
    // For keycodes: http://www.javascripter.net/faq/keycodes.htm
    document.onkeydown = (e) => {
      switch (e.keyCode) {
        case 32: // space to move living Tet all the way down
          if (that.canTetMove() === true) {
            while (!that.newTet && that.currTet) {
              that.currTet.moveDown()
            }
            that.draw()
            that.tetDownLoop()
          }
          break
        case 38: // up arrow to rotate Tet clockwise
          if (that.canTetMove() === true && that.currTet) {
            that.currTet.rotate()
            that.draw()
          }
          break
        case 37: // left arrow to move Tet left
          if (that.canTetMove() === true && that.currTet) {
            that.currTet.moveLeft()
            that.draw()
          }
          break
        case 39: // right arrow to move Tet right
          if (that.canTetMove() === true && that.currTet) {
            that.currTet.moveRight()
            that.draw()
          }
          break
        case 40: // down arrow to move Tet down
          if (that.canTetMove() === true && that.currTet) {
            let skip = false
            if (that.newTet) skip = true
            if (!skip) clearInterval(that.loop)
            that.currTet.moveDown()
            that.draw()
            if (!skip && !that.paused) that.tetDownLoop()
          }
          break
        case 80: case 83: // p for pause, s for stop (they do same thing)
          if (that.gameOver === false) {
            if (!that.paused) {
              clearInterval(that.loop)
              that.paused = true
              that.draw()
            } else {
              if (that.gameOver === false) {
                that.tetDownLoop()
                that.dropOnce = false
              }
              that.paused = false
              that.draw()
            }
          }
          break
        case 82: // r for reset
          that.allTets = []
          clearInterval(that.loop)
          that.currTet = null
          that.gameOver = false
          that.newTet = true
          that.nextTet = null
          that.paused = true
          that.score = 0
          that.updateScore = true
          that.createTet()
          break
        // Developer's Controls
        case 35: // end key to move Tet up
          if (that.devModeOn && that.currTet) {
            if (that.currTet.topLeft.row > 0) {
              that.currTet.topLeft.row--
            }
            that.draw()
          }
          break
        case 48: case 49: case 50: case 51: case 52: // test cases found in TestCase.js
        case 53: case 54: case 55: case 56: case 57: // number keys 0 to 9 (not numpad)
          if (that.devModeOn) {
            that.allTets = []
            that.gameOver = false
            that.score = 0
            that.updateScore = true
            that.testCase(e.keyCode - 48)
            that.createTet()
            that.tetDownLoop()
          }
          break
        case 71: // g for game over
          if (that.devModeOn) {
            that.gameOver = true
            clearInterval(that.loop)
            // that.score = 1939999955999999 // near max
            that.score = Math.random() * 100000
            that.updateScore = true
            that.draw()
          }
          break
        case 72: // h to reset high score to zero
          if (that.devModeOn) {
            that.setHighScores([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            that.displayHighScores()
            that.draw()
          }
          break
        case 192: // tilde key to toggle dev mode
          that.devModeOn = that.devModeOn
          that.draw()
          break
        default:
          console.log('unrecognized key: ' + e.keyCode)
      }
    }
  }

  /**
   * This method is exclusively used in the handleEvents method. We call it
   * every time we want to check if our Tet can be moved with the space bar and
   * up/right/left/down arrow keys.
   * @returns If the Tet can move, based on the conditions within the function,
   *     then return true.
   */
  canTetMove() {
    return ((this.newTet === false && this.paused === false) ||
        this.devModeOn === true) && this.gameOver === false
  }

  /**
   * This method is used to get a floating point number and separate it with
   * commas. We also round the number to the nearest integer.
   * @param number A non-comma separated number.
   * @returns A comma separated number.
   */
  commaSeparateNumber(number: number) {
    const numIn = Math.floor(number)
    let numOut = numIn.toString()

    if (numIn <= 99999999999999) {
      // from http://stackoverflow.com/a/12947816
      const get3ConsecutiveDigits = /(\d+)(\d{3})/
      while (get3ConsecutiveDigits.test(numOut)) {
        numOut = numOut.replace(get3ConsecutiveDigits, '$1' + ',' + '$2')
      }
    } else if (numIn > 999999999999999) {
      numOut = numIn.toExponential(10)
    }

    return numOut
  }

  /**
   * This method updates the high score list that is displayed on the web page.
   */
  displayHighScores() {
    const highScores = this.getHighScores()
    let html = ''
    const len = highScores.length
    for (let i = 0; i < len; i++) {
      html += '<li>' + this.commaSeparateNumber(highScores[i]) + '</li>'
    }
    // TODO: Figure out of this is the best implementation of this
    let elem: any = document.getElementById(this.highScoresListId) || false
    if (elem) elem.innerHTML = html
  }

  /** This method draws everything to the canvas. */
  draw() {
    // Keys, in order, reflect the HTML color code of Tets: I, J, L, O, S, T, Z
    const tetColor = ['#3cc', '#0af', '#f90', '#ee0', '#0c0', '#c0c', '#c00']
  
    const c = this.canvas.getContext('2d')

    // TODO: Figure out a more graceful way of doing this
    if (!c || !this.nextTet) return

    c.clearRect(0, 0, this.canvas.width, 2 * this.canvas.width) // clear canvas
  
    // Draw top panel
    // paused
    if (this.paused) {
      c.fillStyle = '#f00'
      c.font = '16px Arial'
      c.fillText('PAUSED', 5, 74)
    }
    // score
    c.fillStyle = '#000'
    c.font = '16px Arial'
    // 16 numbers max, or 14 with commas. If beyond, switch to scientific
    // notation:
    c.fillText('Score: ' + this.commaSeparateNumber(this.score), 4, 17)
    // next Tet
    c.font = '16px Arial'
    c.fillText('Next:', 35, 50)
    c.beginPath()
    c.moveTo(
        (this.nextTet.topLeft.col + this.nextTet.perim[0][0]) *
            this.blockS,
        (this.nextTet.topLeft.row + this.nextTet.perim[0][1]) *
            this.blockS + 37)
    const len = this.nextTet.perim.length
    for (let row = 1; row < len; row++) {
      c.lineTo(
          (this.nextTet.topLeft.col + this.nextTet.perim[row][0]) *
              this.blockS,
          (this.nextTet.topLeft.row + this.nextTet.perim[row][1]) *
              this.blockS + 37)
    }
    c.closePath()
    c.lineWidth = 2
    c.fillStyle = tetColor[this.nextTet.type]
    c.fill()
    c.strokeStyle = '#000'
    c.stroke()
    // separator line
    c.beginPath()
    c.moveTo(0, this.panelHeight)
    c.lineTo(this.canvasWidth, this.panelHeight)
    c.lineWidth = 2
    c.strokeStyle = '#eee'
    c.stroke()
    c.beginPath()
    c.moveTo(0, this.panelHeight)
    c.lineTo(4 * this.blockS - 3, this.panelHeight)
    c.lineTo(4 * this.blockS - 3, 2 * this.blockS - 6)
    c.lineTo(2 * 4 * this.blockS + 3, 2 * this.blockS - 6)
    c.lineTo(2 * 4 * this.blockS + 3, this.panelHeight)
    c.lineTo(this.canvasWidth, this.panelHeight)
    c.lineWidth = 2
    c.strokeStyle = '#000'
    c.stroke()
    // dev mode indicator
    if (this.devModeOn) {
      c.fillStyle = '#0a0'
      c.font = '15px Arial'
      c.fillText('DEV', 166, 74)
    }
  
    // Draw living Tet "shadow" at bottom and rotation
    if (!this.newTet) {
      // TODO: Figure out a more graceful way of doing this
      if (!this.currTet) {
        return
      }

      const tmpPotTopLeft = {
        row: this.currTet.topLeft.row + 1,
        col: this.currTet.topLeft.col
      }
      while (!this.currTet.doesTetCollideBot(tmpPotTopLeft)) {
        tmpPotTopLeft.row++
      }
      tmpPotTopLeft.row--
      c.beginPath()
      c.moveTo(
          (tmpPotTopLeft.col + this.currTet.perim[0][0]) *
              this.blockS,
          (tmpPotTopLeft.row + this.currTet.perim[0][1]) *
              this.blockS + this.panelHeight)
      const len = this.currTet.perim.length
      for (let row = 1; row < len; row++) {
      c.lineTo(
          (tmpPotTopLeft.col + this.currTet.perim[row][0]) *
              this.blockS,
          (tmpPotTopLeft.row + this.currTet.perim[row][1]) *
              this.blockS + this.panelHeight)
      }
      c.closePath()
      c.lineWidth = 2
      c.fillStyle = '#eee'
      c.fill()
      c.strokeStyle = '#ddd'
      c.stroke()
  
      // draw pivot shadow
      if (this.currTet.pivot > 0) {
        const potPerim = this.currTet.doesNotTetPivotCollide()
        if (potPerim !== false) {
          c.beginPath()
          c.moveTo(
              (this.currTet.topLeft.col + potPerim[0][0] + this.currTet.pivot) *
                  this.blockS,
              (this.currTet.topLeft.row + potPerim[0][1]) *
                  this.blockS + this.panelHeight)
          const len = this.currTet.perim.length
          for (let row = 1; row < len; row++) {
            c.lineTo(
                (this.currTet.topLeft.col + potPerim[row][0] +
                    this.currTet.pivot) * this.blockS,
                (this.currTet.topLeft.row + potPerim[row][1]) *
                    this.blockS + this.panelHeight)
          }
          c.closePath()
          c.lineWidth = 2
          c.globalAlpha = 0.5
          c.fillStyle = '#eee'
          c.fill()
          c.strokeStyle = '#ddd'
          c.stroke()
          c.globalAlpha = 1
        }
      }
    }
  
    // Draw all Tets
    const aTLen = this.allTets.length
    for (let tet = 0; tet < aTLen; tet++) {
      const currTet = this.allTets[tet]
      c.beginPath()
      c.moveTo(
          (currTet.topLeft.col + currTet.perim[0][0]) * this.blockS,
          (currTet.topLeft.row + currTet.perim[0][1]) * this.blockS +
              this.panelHeight)
      const len = currTet.perim.length
      for (let row = 1; row < len; row++) {
        c.lineTo(
            (currTet.topLeft.col + currTet.perim[row][0]) * this.blockS,
            (currTet.topLeft.row + currTet.perim[row][1]) * this.blockS +
                this.panelHeight)
      }
      c.closePath()
      c.lineWidth = 2
      c.fillStyle = tetColor[currTet.type]
      c.fill()
      c.strokeStyle = '#000'
      c.stroke()
    }
  
    // Draw Game Over text if game is over
    if (this.gameOver) {
      // gray tint
      c.globalAlpha = 0.8
      c.fillStyle = '#333'
      c.fillRect(0, 0, this.canvas.width, 2 * this.canvas.width)
      c.globalAlpha = 1
      // game over text
      c.fillStyle = '#f00'
      c.font = 'bold 32px Arial'
      c.fillText('GAME OVER', 3, 180)
      c.strokeStyle = '#000'
      c.lineWidth = 1
      c.strokeText('GAME OVER', 3, 180)
      // your score
      c.fillStyle = '#fff'
      c.font = 'bold 18px Arial'
      c.fillText('Your Score:', 5, 220)
      c.fillStyle = '#f00'
      c.font = 'bold 19px Arial'
      c.fillText(this.commaSeparateNumber(this.score), 14, 240)
      c.globalAlpha = 0.5
      c.strokeStyle = '#000'
      c.lineWidth = 1
      c.font = 'bold 18px Arial'
      c.strokeText('Your Score:', 5, 220)
      c.font = 'bold 19px Arial'
      c.strokeText(this.commaSeparateNumber(this.score), 14, 240)
      c.globalAlpha = 1
      // personal highest score
      const highscores = this.checkHighScore()
      c.fillStyle = '#fff'
      c.font = 'bold 17px Arial'
      c.fillText('Personal Highest Score:', 5, 270)
      c.fillStyle = '#f00'
      c.font = 'bold 19px Arial'
      c.fillText(this.commaSeparateNumber(highscores[0]), 14, 290)
      c.globalAlpha = 0.3
      c.strokeStyle = '#000'
      c.lineWidth = 1
      c.font = 'bold 17px Arial'
      c.strokeText('Personal Highest Score:', 5, 270)
      c.font = 'bold 19px Arial'
      c.strokeText(this.commaSeparateNumber(highscores[0]), 14, 290)
      c.globalAlpha = 1
      this.displayHighScores()
    }
  }

  /**
   * This method creates Tets. This also causes the Game Over screen to appear
   * when we cannot create a new Tet.
   */
  createTet() {
    // Make sure first Tet is not an S or Z
    if (this.nextTet === null) {
      let t: number = Math.floor(Math.random() * 7)
      // TODO: Instead of doing this, keep randomly generating a number until
      // it's not a 4 or 6. This way there isn't a higher likelihood of starting
      // off with a 3 or 5 (should be as fairly random as possible) - plus there
      // isn't a performance issue to worry about since this gets generated
      // before the game even starts.
      if (t === 4 || t === 6) {
        t--
      }
      this.nextTet = new Tet(this, t)
    }

    // Build first Tet and next Tet
    if (this.newTet) {
      this.currTet = this.nextTet
      this.nextTet = new Tet(this)
    }
    this.newTet = false

    // TODO: Figure out how to make this check unnecessary since ideally this
    // would never be null.
    if (!this.currTet) {
      this.currTet = this.nextTet
    }

    // Display Game Over
    if (this.currTet.doesTetCollideBot(this.currTet.topLeft)) {
      this.nextTet = this.currTet
      this.gameOver = true
      this.newTet = true
      clearInterval(this.loop)
      return
    } else {
      this.allTets.push(this.currTet)
    }

    this.draw()
  }

  /**
   * This method creates a setInterval loop which moves our currTet down at
   * each interval.
   */
  tetDownLoop() {
    // safe guard to prevent multiple loops from spawning before clearing it out
    // first
    clearInterval(this.loop)

    const that = this
    this.loop = setInterval(() => {
      if (that.dropOnce && that.newTet) clearInterval(that.loop)
      if (that.newTet) that.createTet()
      else if (!that.paused && that.currTet) that.currTet.moveDown()
      that.draw()
    }, that.dropInterval)
  }

  /**
   * This method generates a landed array from allTets to be used to check for
   * Tet/fragment collisions.
   * @param tet This parameter basically excludes the given Tet from allTets
   *     which are used to generate the landed array.
   */
  getLanded(tet?: Tet) {
    if (tet !== undefined) this.updateLanded = true
    if (this.updateLanded) {
      for (let i = 0; i < Game.BOARD_ROW_NUM; i++) {
        this.landed[i] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      }
      const aT = this.allTets
      const len = aT.length
      for (let i = 0; i < len; i++) {
        if (aT[i] === this.currTet || aT[i] === tet) continue
        const rLen = aT[i].shape.length
        for (let row = 0; row < rLen; row++) {
          const cLen = aT[i].shape[row].length
          for (let col = 0; col < cLen; col++) {
            if (aT[i].shape[row][col] !== 0) {
              this.landed[row + aT[i].topLeft.row][col + aT[i].topLeft.col] = 1
            }
          }
        }
      }
      this.updateLanded = false
    }

    return this.landed
  }

  /**
   * This method inserts all zeros into the rows of the shape array if they are
   * going to be removed. Once we do this, we call the updateLanded method.
   * @param fullRows This is the list of all rows that are to be removed from
   *     the Tet shapes.
   */
  alterShapes(fullRows: number[]) {
    const firstRow = fullRows[0]
    const lastRow = fullRows[fullRows.length - 1]
    const len = this.allTets.length
    for (let tet = 0; tet < len; tet++) {
      if (this.allTets[tet].topLeft.row <= firstRow - 4 ||
          this.allTets[tet].topLeft.row > lastRow) {
        continue
      }
      this.allTets[tet].alterShape(fullRows)
    }
    // this.tetsToRemove.sort(function(a,b){ return a - b }) // ensures indices
    // are in numeric order
    const len2 = this.tetsToRemove.length
    for (let i = 0; i < len2; i++) {
      this.allTets.splice(this.tetsToRemove[i] - i, 1)
    }
    this.tetsToRemove = []
    this.updateLanded = true
  }

  /**
   * This method came from:
   * {@link http://www.w3schools.com/js/js_cookies.asp|W3Schools}. It allows us
   * to use cookies to retrieve the user's info.
   * @param cName This is the name of the cookie we want.
   * @returns This is the string extracted from our cookie.
   */
  getCookie(cName: string) {
    let cValue: string | null = document.cookie
    let cStart = cValue.indexOf(' ' + cName + '=')
    if (cStart === -1) cStart = cValue.indexOf(cName + '=')
    if (cStart === -1) cValue = null
    else {
      cStart = cValue.indexOf('=', cStart) + 1
      let cEnd = cValue.indexOf(';', cStart)
      if (cEnd === -1) cEnd = cValue.length
      cValue = unescape(cValue.substring(cStart, cEnd))
    }

    return cValue
  }

  /**
   * This method came from:
   * {@link http://www.w3schools.com/js/js_cookies.asp|W3Schools}. It allows us
   * to use cookies to store the user's info.
   * @param cName This is the name of the cookie we want.
   * @param value This is the value of the cookie we want to set.
   * @param exDays This is the expiration date of the cookie.
   */
  setCookie(cName: string, value: string, exDays: number) {
    const exdate = new Date()
    exdate.setDate(exdate.getDate() + exDays)
    const cValue = escape(value) +
        ((exDays === null) ? '' : '; expires=' + exdate.toUTCString())
    document.cookie = cName + '=' + cValue
  }

  /**
   * This method gets the user's high scores from their cookie.
   * @returns This is the list of the high scores of the user.
   */
  getHighScores() {
    const hsFromCookie = this.getCookie('highScores')
    let hsOut: number[]
    if (hsFromCookie === null) {
      hsOut = [this.score, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      this.setHighScores(hsOut)
    } else {
      hsOut = JSON.parse(hsFromCookie)
    }
    return hsOut
  }

  /**
   * This method saves the user's high scores into the cookie.
   * @param v This is the list of the high scores we're going to save in the
   *     cookie.
   */
  setHighScores(v: number[]) {
    this.setCookie('highScores', JSON.stringify(v), 365)
  }

  /**
   * This method basically adjusts the user's high scores if they made a higher
   * score than before.
   * @returns This is the list of the high scores of the user.
   */
  checkHighScore() {
    const highScores = this.getHighScores()
    if (this.updateScore === true) {
      const hsLen = highScores.length
      for (let i = 0; i < hsLen; i++) {
        if (this.score > highScores[i]) {
          highScores.splice(i, 0, this.score)
          break
        }
      }
      if (highScores.length > hsLen) highScores.pop()
      this.setHighScores(highScores)
      this.updateScore = false
    }

    return highScores
  }

  // TODO: This is from TestCase.js
  testCase(n: number) {
    console.warn('Test cases not enabled yet.')
  }
}

/**
 * Used in Tet to represent a Tet during the cleanShape() and updateTet() phases
 */
interface TetRep {
  shape: number[][],
  topLeft: {
    row: number,
    col: number
  }
}

/**
 * This function creates a Tet class intended to be instantiated by "new Tet()".
 * However, upon completing a row in our Tetris game, we will want to remove the
 * blocks in that row.
 * 
 * In the case that our Tet becomes divided during the row removal, we will want
 * to split the whole Tet into multiple Tet fragments which is when we will use
 * "new Tet(-1)", then set its properties manually.
 * @class Represents a Tet, both living and landed.
 */
class Tet {
  /** Game object which the Tet is in */
  private game: Game
  /**
   * Initially only used to determined its shape upon our class being
   * constructed. If in range [0..6] (number of Tets), set its properties
   * appropriately. If -1, we will create a Tet with empty properties because
   * we're going to set its topLeft, shape and perimeter manually.
   */
  type: number
  /**
   * Rotation is constrained by the range [0..3]. Incrementing the rotation
   * basically rotates the shape clockwise. This rotation decides our this.shape
   * and this.perim.
   */
  rotation: number
  /**
   * This is the number of rows we are going to move our tet when we decide to
   * rotate it. Constraints are from [0..this.pivotMax].
   */
  pivot: number
  /** This is the maximum amount of times a block can be pivoted. */
  pivotMax: number
  /**
   * This is the (row, column) position the Tet is in with respect to the game
   * board (16 rows by 10 columns); (0, 0) being the most top left position.
   * 
   * topLeft.row - Row position of Tet on board.
   * 
   * topLeft.col - Column position of Tet on board.
   */
  topLeft: {row: number, col: number}
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
      this.topLeft = {row: 0, col: 4}
      this.setShape(this.getShapeMatrix(0))
    }
  }

  /**
   * This method takes in a Tet type and rotation then outputs its shape matrix.
   * This method is only needed on a live Tet. I.e. if a Tet is already placed
   * on the landed array, this method will not be used.
   * @param rotation Rotation of shape, determined by user input.
   * @returns Number matrix of shape.  If type is unexpected, return empty
   *     array.
   */
  getShapeMatrix(rotation: number) {
    // Shapes are from: http://en.wikipedia.org/wiki/Tetris#Colors_of_Tetriminos
    // The numbers in these arrays denote their eventual color.
    // NOTE: Trailing zeros were removed and replaced by spaces in the following
    // matrices as a reasonable optimization for gaming (preventing unnecessary
    // loop iterations).
    /* eslint-disable comma-spacing, no-multi-spaces, standard/array-bracket-even-spacing */
    const matrixMatrix = [
      [ [[1,1,1,1]],       [[1],[1],[1],[1]] ], // I
      [ [[1,1,1],[0,0,1]], [[0,1],[0,1],[1,1]], [[1    ],[1,1,1]], [[1,1],[1  ],[1  ]] ], // J
      [ [[1,1,1],[1    ]], [[1,1],[0,1],[0,1]], [[0,0,1],[1,1,1]], [[1  ],[1  ],[1,1]] ], // L
      [ [[1,1],  [1,1]] ], // O
      [ [[0,1,1],[1,1  ]], [[1  ],[1,1],[0,1]] ], // S
      [ [[1,1,1],[0,1  ]], [[0,1],[1,1],[0,1]], [[0,1  ],[1,1,1]], [[1  ],[1,1],[1  ]] ], // T
      [ [[1,1  ],[0,1,1]], [[0,1],[1,1],[1  ]] ] // Z
    ]
    /* eslint-enable comma-spacing, no-multi-spaces, standard/array-bracket-even-spacing */
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
  getPerim(shape: number[][]) {
    // NOTE: Trailing zeros were removed and replaced by spaces in the following
    // matrices as a gaming optimization (preventing unnecessary loop
    // iterations).
    /* eslint-disable comma-spacing, no-multi-spaces, standard/array-bracket-even-spacing */
    const periMatrix = [
      [ [[1]],               [[0,0],[0,1],[1,1],[1,0]] ], // fragments
      [ [[1,1]],             [[0,0],[0,1],[2,1],[2,0]] ],
      [ [[1],[1]],           [[0,0],[0,2],[1,2],[1,0]] ],
      [ [[1,1,1]],           [[0,0],[0,1],[3,1],[3,0]] ],
      [ [[1],[1],[1]],       [[0,0],[0,3],[1,3],[1,0]] ],
      [ [[1,1],[0,1]],       [[0,0],[0,1],[1,1],[1,2],[2,2],[2,0]] ],
      [ [[0,1],[1,1]],       [[1,0],[1,1],[0,1],[0,2],[2,2],[2,0]] ],
      [ [[1  ],[1,1]],       [[0,0],[0,2],[2,2],[2,1],[1,1],[1,0]] ],
      [ [[1,1],[1  ]],       [[0,0],[0,2],[1,2],[1,1],[2,1],[2,0]] ],
      [ [[1,1,1,1]],         [[0,0],[0,1],[4,1],[4,0]] ], // I
      [ [[1],[1],[1],[1]],   [[0,0],[0,4],[1,4],[1,0]] ],
      [ [[1,1,1],[0,0,1]],   [[0,0],[0,1],[2,1],[2,2],[3,2],[3,0]] ], // J
      [ [[0,1],[0,1],[1,1]], [[1,0],[1,2],[0,2],[0,3],[2,3],[2,0]] ],
      [ [[1    ],[1,1,1]],   [[0,0],[0,2],[3,2],[3,1],[1,1],[1,0]] ],
      [ [[1,1],[1  ],[1  ]], [[0,0],[0,3],[1,3],[1,1],[2,1],[2,0]] ],
      [ [[1,1,1],[1    ]],   [[0,0],[0,2],[1,2],[1,1],[3,1],[3,0]] ], // L
      [ [[1,1],[0,1],[0,1]], [[0,0],[0,1],[1,1],[1,3],[2,3],[2,0]] ],
      [ [[0,0,1],[1,1,1]],   [[2,0],[2,1],[0,1],[0,2],[3,2],[3,0]] ],
      [ [[1  ],[1  ],[1,1]], [[0,0],[0,3],[2,3],[2,2],[1,2],[1,0]] ],
      [ [[1,1],[1,1]],       [[0,0],[0,2],[2,2],[2,0]] ], // O
      [ [[0,1,1],[1,1  ]],   [[1,0],[1,1],[0,1],[0,2],[2,2],[2,1],[3,1],[3,0]] ], // S
      [ [[1  ],[1,1],[0,1]], [[0,0],[0,2],[1,2],[1,3],[2,3],[2,1],[1,1],[1,0]] ],
      [ [[1,1,1],[0,1  ]],   [[0,0],[0,1],[1,1],[1,2],[2,2],[2,1],[3,1],[3,0]] ], // T
      [ [[0,1],[1,1],[0,1]], [[1,0],[1,1],[0,1],[0,2],[1,2],[1,3],[2,3],[2,0]] ],
      [ [[0,1  ],[1,1,1]],   [[1,0],[1,1],[0,1],[0,2],[3,2],[3,1],[2,1],[2,0]] ],
      [ [[1  ],[1,1],[1  ]], [[0,0],[0,3],[1,3],[1,2],[2,2],[2,1],[1,1],[1,0]] ],
      [ [[1,1  ],[0,1,1]],   [[0,0],[0,1],[1,1],[1,2],[3,2],[3,1],[2,1],[2,0]] ], // Z
      [ [[0,1],[1,1],[1  ]], [[1,0],[1,1],[0,1],[0,3],[1,3],[1,2],[2,2],[2,0]] ]
    ]
    /* eslint-enable comma-spacing, no-multi-spaces, standard/array-bracket-even-spacing */
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
  setShape(shape: number[][]) {
    this.shape = shape
    this.perim = this.getPerim(shape)
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
  doesTetCollideBot(potTopLeft: {row: number, col: number}) {
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
  doesTetCollideSide(
        potTopLeft: {row: number, col: number},
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
   * This method handles row elimination and Tet fragmentation. We also adjust
   * the score depending on how many rows get eliminated. The score scales with
   * how many rows get eliminated at once by the following formula:
   * 
   * `score += (fRLen ** (1 + (fRLen - 1) * 0.1)) * 10000`
   * 
   * We then perform the falling animations on the Tets affected by "gravity."
   */
  collided() {
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
    const moveLoop = setInterval(() => {
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
  // cleanShape(o: {shape: number[][], topLeft: {row: number, col: number}}) {
  cleanShape(o: TetRep): TetRep {
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
    return {shape: shape, topLeft: topLeft}
  }

  /**
   * This method checks to see if itself, an array, is all zeros.
   * @returns If itself is all zeros, return true; else, false.
   */
  arrayIsAllZeros(arr: number[]) {
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
  updateTet() {
    // const q: {shape: number[][], topLeft: {row: number, col: number}}[] = []
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
          topLeft = {row: this.topLeft.row + row, col: this.topLeft.col}
        }
        currShape.push(this.shape[row])
      // FIXME: Otherwise, push this current shape onto the queue and reset our
      // temporary shape to potentially build another
      } else {
        if (currShape.length === 0) continue
        q.push({shape: currShape, topLeft: topLeft})
        currShape = []
      }
    }

    if (currShape.length > 0) q.push({shape: currShape, topLeft: topLeft})

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

  /**
   * This method sets each row within its shape to zero for each row marked as
   * full.
   * @param fullRows This is an array of all of the rows that were marked as
   *     full in the collided method above.
   */
  alterShape(fullRows: number[]) {
    const len = fullRows.length
    for (let i = 0, row; i < len; i++) {
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
}
