/// <reference types="node" />
/**
 * @author Jared Gotte
 */
/** Represents our game board and interface */
declare class Game {
    /** Developer Mode (when enabled/true, test cases can be ran via keybinds) */
    devModeOn: boolean;
    /**
     * Since the Tetris standard is to have 10 horizontal blocks by 16 vertical
     * blocks, this is a constant set to 16.
     */
    static readonly BOARD_ROW_NUM: number;
    /**
     * Since the Tetris standard is to have 10 horizontal blocks by 16 vertical
     * blocks, this is a constant set to 10.
     */
    static readonly BOARD_COL_NUM: number;
    /**
     * If true, we want to create a new Tet at the beginning of the loop
     * interval.
     *
     * Defaults as true since we always want to create a new Tet at the beginning
     * of the game.
     */
    newTet: boolean;
    /**
     * The Tet that's falling and being controlled by the player.
     *
     * Defaults as null since we don't start off with any Tets the moment the game
     * gets intialized.
     */
    currTet: Tet | null;
    /**
     * The Tet that's going to come into play after the currTet lands.
     *
     * Defaults as null since we don't start off with any Tets the moment the game
     * gets intialized.
     */
    nextTet: Tet | null;
    /**
     * If true, we should update our landed array to be used in collision
     * detection.
     */
    updateLanded: boolean;
    /** This is the array of all Tets that are in the game. */
    allTets: Tet[];
    /**
     * This is the array of all Tets that need to be removed before being drawn.
     */
    tetsToRemove: number[];
    /** This is the score that we're going to use to display. */
    score: number;
    /**
     * This is the boolean we check to see if we should update our high score list
     * or not.
     */
    updateScore: boolean;
    /** TODO: Add comment */
    loop: NodeJS.Timer;
    /** TODO: Add comment */
    dropOnce: boolean;
    /**
     * This is the interval, in milliseconds, for which our currTet is going to
     * drop 1 block.
     */
    private dropInterval;
    /**
     * The flag that indicates when the game is over. When true, we handle the
     * "game over" events.
     */
    private gameOver;
    /**
     * This is the width that we set. This width can be adjusted and our game will
     * scale to it.
     */
    private canvasWidth;
    /** This is the length of the side of each "block" on the game, in pixels. */
    private blockS;
    /** This is the DOM element for which we are going to be drawing on. */
    private canvas;
    /**
     * This is the height of the panel which houses our score, nextTet, and
     * PAUSED/DEV text.
     */
    private panelHeight;
    /**
     * This is the array of array of numbers which we are going to populate with
     * our allTets to be able to detect Tet collision.
     */
    private landed;
    /** TODO: Add comment */
    private paused;
    /**
     * This is the name of the high score list DOM element for which we are going
     * to show our user their past high scores.
     */
    private highScoresListId;
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
    constructor(canvasId: string, highScoresListId: string, devModeOn?: boolean);
    /**
     * This method creates 3 event listeners (2 for the window and 1 for the
     * document). The 2 events for the window are onblur and onfocus. These will
     * pause the game when you leave the game window and resume it when you come
     * back. The event for the document listens for onkeydown events. These
     * basically allow the user to interact with the game.
     */
    handleEvents(): void;
    /**
     * This method is exclusively used in the handleEvents method. We call it
     * every time we want to check if our Tet can be moved with the space bar and
     * up/right/left/down arrow keys.
     * @returns If the Tet can move, based on the conditions within the function,
     *     then return true.
     */
    canTetMove(): boolean;
    /**
     * This method is used to get a floating point number and separate it with
     * commas. We also round the number to the nearest integer.
     * @param number A non-comma separated number.
     * @returns A comma separated number.
     */
    commaSeparateNumber(number: number): string;
    /**
     * This method updates the high score list that is displayed on the web page.
     */
    displayHighScores(): void;
    /** This method draws everything to the canvas. */
    draw(): void;
    /**
     * This method creates Tets. This also causes the Game Over screen to appear
     * when we cannot create a new Tet.
     */
    createTet(): void;
    /**
     * This method creates a setInterval loop which moves our currTet down at
     * each interval.
     */
    tetDownLoop(): void;
    /**
     * This method generates a landed array from allTets to be used to check for
     * Tet/fragment collisions.
     * @param tet This parameter basically excludes the given Tet from allTets
     *     which are used to generate the landed array.
     */
    getLanded(tet?: Tet): number[][];
    /**
     * This method inserts all zeros into the rows of the shape array if they are
     * going to be removed. Once we do this, we call the updateLanded method.
     * @param fullRows This is the list of all rows that are to be removed from
     *     the Tet shapes.
     */
    alterShapes(fullRows: number[]): void;
    /**
     * This method came from:
     * {@link http://www.w3schools.com/js/js_cookies.asp|W3Schools}. It allows us
     * to use cookies to retrieve the user's info.
     * @param cName This is the name of the cookie we want.
     * @returns This is the string extracted from our cookie.
     */
    getCookie(cName: string): string | null;
    /**
     * This method came from:
     * {@link http://www.w3schools.com/js/js_cookies.asp|W3Schools}. It allows us
     * to use cookies to store the user's info.
     * @param cName This is the name of the cookie we want.
     * @param value This is the value of the cookie we want to set.
     * @param exDays This is the expiration date of the cookie.
     */
    setCookie(cName: string, value: string, exDays: number): void;
    /**
     * This method gets the user's high scores from their cookie.
     * @returns This is the list of the high scores of the user.
     */
    getHighScores(): number[];
    /**
     * This method saves the user's high scores into the cookie.
     * @param v This is the list of the high scores we're going to save in the
     *     cookie.
     */
    setHighScores(v: number[]): void;
    /**
     * This method basically adjusts the user's high scores if they made a higher
     * score than before.
     * @returns This is the list of the high scores of the user.
     */
    checkHighScore(): number[];
    testCase(n: number): void;
}
/**
 * Used in Tet to represent a Tet during the cleanShape() and updateTet() phases
 */
interface TetRep {
    shape: number[][];
    topLeft: {
        row: number;
        col: number;
    };
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
declare class Tet {
    /** Game object which the Tet is in */
    private game;
    /**
     * Initially only used to determined its shape upon our class being
     * constructed. If in range [0..6] (number of Tets), set its properties
     * appropriately. If -1, we will create a Tet with empty properties because
     * we're going to set its topLeft, shape and perimeter manually.
     */
    type: number;
    /**
     * Rotation is constrained by the range [0..3]. Incrementing the rotation
     * basically rotates the shape clockwise. This rotation decides our this.shape
     * and this.perim.
     */
    rotation: number;
    /**
     * This is the number of rows we are going to move our tet when we decide to
     * rotate it. Constraints are from [0..this.pivotMax].
     */
    pivot: number;
    /** This is the maximum amount of times a block can be pivoted. */
    pivotMax: number;
    /**
     * This is the (row, column) position the Tet is in with respect to the game
     * board (16 rows by 10 columns); (0, 0) being the most top left position.
     *
     * topLeft.row - Row position of Tet on board.
     *
     * topLeft.col - Column position of Tet on board.
     */
    topLeft: {
        row: number;
        col: number;
    };
    /**
     * Shape of Tet, e.g. _shape = [[1,1,1,1]] is horizontal I Tetrimino where
     * [[1],[1],[1],[1]] is vertical I Tet. Number of 0 indicates empty space.
     */
    shape: number[][];
    /**
     * Perimeter of Tet, e.g. _perim = [[0,0],[0,1],[4,1],[4,0]] is horizontal
     * I Tet perimeter where [[0,0],[0,4],[1,4],[1,0]] is vertical I Tet. Imagine
     * Tetriminos being expressed as 4 "blocks," each block's side would be _s
     * pixels in magnitude, where _s is the variable blockS defined in index.php.
     * Therefore, we can determine its perimeter by taking the "(x, y) coordinates"
     * in each "row" of _perim, and multiplying each x and y value by _s.
     */
    perim: number[][];
    /**
     * @param game Game object which the Tet will be in
     * @param [type] Shape of Tet desired, determined randomly if undefined.
     */
    constructor(game: Game, type?: number);
    /**
     * This method takes in a Tet type and rotation then outputs its shape matrix.
     * This method is only needed on a live Tet. I.e. if a Tet is already placed
     * on the landed array, this method will not be used.
     * @param rotation Rotation of shape, determined by user input.
     * @returns Number matrix of shape.  If type is unexpected, return empty
     *     array.
     */
    getShapeMatrix(rotation: number): number[][];
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
    getPerim(shape: number[][]): number[][];
    /**
     * This method actually sets the shape and perimeter of the Tet that's
     * executing this method.
     * @param shape This is the shape of the Tet we care about getting the
     *     perimeter from.
     */
    setShape(shape: number[][]): void;
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
    rotate(): boolean;
    /**
     * This method checks to see if the pivot shape shadow can display properly.
     * @returns This returns the perimeter matrix given by the getPerim()
     *     method.
     */
    doesNotTetPivotCollide(): false | number[][];
    /**
     * This method checks to see if a Tet will collide with the bottom of the game
     * board or another Tet.
     * @param potTopLeft This object contains a potential row and column
     *     which we use to check to see if the Tet will collide if it moves to the
     *     coordinate specified by this param.
     * @returns If Tet colides, return true; else, false.
     */
    doesTetCollideBot(potTopLeft: {
        row: number;
        col: number;
    }): boolean;
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
    doesTetCollideSide(potTopLeft: {
        row: number;
        col: number;
    }, direction?: number): boolean;
    /**
     * This method moves the Tet left by 1 column if it does not collide with the
     * side of the game board or another Tet. This method also resets the pivot to
     * zero.
     */
    moveLeft(): void;
    /**
     * This method moves the Tet right by 1 column if it does not collide with the
     * side of the game board or another Tet.
     */
    moveRight(): void;
    /**
     * This method moves the Tet down by 1 column if it does not collide with the
     * side of the game board or another Tet. If it does collide, the Tet lands,
     * we create another Tet, and we perform the collided method to handle row
     * elimination and Tet fragmentation.
     */
    moveDown(): void;
    /**
     * This method handles row elimination and Tet fragmentation. We also adjust
     * the score depending on how many rows get eliminated. The score scales with
     * how many rows get eliminated at once by the following formula:
     *
     * `score += (fRLen ** (1 + (fRLen - 1) * 0.1)) * 10000`
     *
     * We then perform the falling animations on the Tets affected by "gravity."
     */
    collided(): void;
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
    cleanShape(o: TetRep): TetRep;
    /**
     * This method checks to see if itself, an array, is all zeros.
     * @returns If itself is all zeros, return true; else, false.
     */
    arrayIsAllZeros(arr: number[]): boolean;
    /**
     * This method parses its own shape to determine if it needs to fragment or
     * not. If it becomes fragmented, we instantiate a new Tet class to add in its
     * fragmented part.
     */
    updateTet(): void;
    /**
     * This method sets each row within its shape to zero for each row marked as
     * full.
     * @param fullRows This is an array of all of the rows that were marked as
     *     full in the collided method above.
     */
    alterShape(fullRows: number[]): void;
}
