import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { bootstrapTetris } from './js/tetris'

interface TopRightBtnProps {
  id: string
  innerHTML: string
}

function TopRightBtn(props: TopRightBtnProps) {
  const id = props.id

  function handleClick() {
    switch (id.substr(0, id.length - 6)) {
      case 'minimize':
        void window.electris.window.minimize()
        break
      case 'close':
        void window.electris.window.close()
        break
    }
  }

  return (
    <button
      className="topButton"
      id={id}
      onClick={handleClick}
    >{props.innerHTML}
    </button>
  )
}

class App extends React.Component {
  componentDidMount() {
    void bootstrapTetris()
  }

  renderTopRightBtn(id: string, innerHTML: string) {
    return (
      <TopRightBtn
        id={id}
        innerHTML={innerHTML}
      />
    )
  }

  render() {
    return (
      <React.Fragment>
        {this.renderTopRightBtn('minimizeButton', '\u2013')}
        {this.renderTopRightBtn('closeButton', '\u00d7')}
        <main id="main">
          {/*<!-- Banner inspired from font: The FontStruction "Tetromino (by Piotr
          Klarowski)" (http://fontstruct.com/fontstructions/show/118906) by
          "ecaGraphics" -->*/}
          <h1><img id="tetris-banner" src="img/TETRIS.png" alt="Tetris logo" /></h1>
          <section className="panel" id="public-controls" aria-labelledby="public-controls-title">
            <h2 id="public-controls-title">Controls</h2>
            <ul>
              <li>
                <h3>Control</h3>
                <h3>Key</h3>
              </li>
              <li>
                <div>
                  <span>Rotate</span>
                </div>
                <span><strong>Up</strong> Arrow Key</span>
              </li>
              <li>
                <div>
                  <span>Move Left</span>
                </div>
                <span><strong>Left</strong> Arrow Key</span>
              </li>
              <li>
                <div>
                  <span>Move Right</span>
                </div>
                <span><strong>Right</strong> Arrow </span></li>
              <li>
                <div>
                  <span>Move Down</span>
                </div>
                <span><strong>Down</strong> Arrow </span>
              </li>
              <li>
                <div>
                  <span>Instantly Move Down</span>
                </div>
                <span><strong>Space</strong> Bar</span>
              </li>
              <br />
              <li>
                <div>
                  <span>Start/Pause Game</span>
                </div>
                <span><strong>S</strong> or <strong>P</strong> Key</span>
              </li>
              <li>
                <div>
                  <span>Restart Game</span>
                </div>
                <span><strong>R</strong> Key</span>
              </li>
            </ul>
          </section>
          <canvas id="canvas" tabIndex={-1} />
          <section className="panel" id="high-scores" aria-labelledby="high-scores-title">
            <h2 id="high-scores-title">High Scores</h2>
            <ol id="high-scores-list" />
          </section>
        </main>
        <div id="footer">
          <span>&copy; 2018 <a href="#author" data-electris-external="author">Jared Gotte</a>; licensed under <a href="#license" data-electris-external="license">ISC</a></span>
        </div>
      </React.Fragment>
    )
  }
}

ReactDOM.render(<App />, document.getElementById('root'))
