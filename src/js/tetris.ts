/**
 * @author Jared Gotte
 */
import { Game } from './game'
import type { ElectrisExternalDestination } from '../electris'

function getElectrisLinkDestination(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const link = target.closest('[data-electris-external]')
  const destination = link?.getAttribute('data-electris-external')
  if (destination === 'author' || destination === 'license') {
    return destination as ElectrisExternalDestination
  }

  return null
}

function bindExternalLinkHandling() {
  document.addEventListener('click', (event) => {
    const destination = getElectrisLinkDestination(event.target)
    if (!destination) return

    event.preventDefault()
    void window.electris.openExternal(destination)
  })
}

export async function bootstrapTetris() {
  bindExternalLinkHandling()
  const highScores = await window.electris.highScores.load()
  const theGame = new Game('canvas', 'high-scores-list', false, {
    highScores,
    persistHighScores: (scores) => window.electris.highScores.save(scores)
  })
  if (!theGame) console.error('Game didn\'t load!', theGame)
}
