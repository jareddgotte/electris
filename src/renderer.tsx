import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Script from 'react-load-script'
// import '../src/css/main.css'

const App = () => {
  return (
    <React.Fragment>
      <button className="topButton" id="minimizeButton">&ndash;</button>
      <button className="topButton" id="closeButton">&times;</button>
      <main id="main">
        {/*<!-- Banner inspired from font: The FontStruction "Tetromino (by Piotr
        Klarowski)" (http://fontstruct.com/fontstructions/show/118906) by
        "ecaGraphics" -->*/}
        <h1><img id="tetris-banner" src="../src/img/TETRIS.png" alt="Tetris logo" /></h1>
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
                <span>Pause Game</span>
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
        <canvas id="canvas" />
        <section className="panel" id="high-scores" aria-labelledby="high-scores-title">
          <h2 id="high-scores-title">High Scores</h2>
          <ol id="high-scores-list" />
        </section>
      </main>
      <div id="footer">
        <span>&copy; 2018 <a href="http://www.jaredgotte.com/">Jared Gotte</a>; licensed under <a href="https://opensource.org/licenses/ISC">ISC</a></span>
      </div>

      {/* <script src="tetris.js"></script>
      Inline JS code now inserted at the bottom of tetris.js */}
      <Script url="tetris.js" />
    </React.Fragment>
  )
}

ReactDOM.render(<App />, document.getElementById('root'))
