/**
 * @author Jared Gotte
 */
import { Game } from './game'

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

const { shell } = require('electron')

// Open any links externally by default
document.addEventListener('click', (event) => {
  if (event.target) {
    const target: HTMLAnchorElement = event.target as HTMLAnchorElement
    if (target.tagName === 'A' && target.href.startsWith('http')) {
      event.preventDefault()
      shell.openExternal(target.href)
    }
  }
})

// Initialize game
const theGame = new Game('canvas', 'high-scores-list')
if (!theGame) console.error('Game didn\'t load!', theGame)
