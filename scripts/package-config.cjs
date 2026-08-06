'use strict'

const path = require('path')

const root = path.resolve(__dirname, '..')
const projectPackage = require(path.join(root, 'package.json'))

// @electron/packager is the Electron-maintained continuation of the project's old
// electron-packager dependency. Its programmatic API lets this repository enforce a
// staged allowlist and clean partial output rather than relying on a broad ignore regex.
// These are locally buildable Packager targets, not release-support claims.
const targets = Object.freeze({
  darwin: Object.freeze(['arm64', 'x64']),
  linux: Object.freeze(['arm64', 'x64']),
  win32: Object.freeze(['arm64', 'ia32', 'x64'])
})

// This is the complete application payload. Webpack bundles React and ReactDOM, while
// main/preload use only Electron and Node built-ins, so no external production
// node_modules are required at runtime. Source maps and declarations are intentionally
// omitted; renderer.js.LICENSE.txt retains generated third-party license notices.
//
// `newlineInsensitive` marks a tracked text asset whose packaged copy may differ from
// the checkout by CRLF versus LF alone, so a package built on a Windows checkout stays
// verifiable from an LF checkout and vice versa. `.gitattributes` normalizes those
// assets at the repository boundary; this flag only keeps verification reproducible
// across checkouts that predate or bypass it. Omitting it is the safe default: every
// other verified asset, including the PNG, is compared byte for byte.
const appFiles = Object.freeze([
  Object.freeze({source: 'app/main.js', packaged: 'main.js'}),
  Object.freeze({source: 'app/preload.js', packaged: 'preload.js'}),
  Object.freeze({source: 'app/renderer.js', packaged: 'renderer.js'}),
  Object.freeze({source: 'app/renderer.js.LICENSE.txt', packaged: 'renderer.js.LICENSE.txt'}),
  Object.freeze({source: 'app/renderer.html', packaged: 'renderer.html'}),
  Object.freeze({
    source: 'app/css/main.css', packaged: 'css/main.css',
    verifySource: true, newlineInsensitive: true
  }),
  Object.freeze({source: 'app/img/TETRIS.png', packaged: 'img/TETRIS.png', verifySource: true}),
  Object.freeze({source: 'LICENSE', packaged: 'LICENSE', verifySource: true, newlineInsensitive: true})
])

const packageRecordName = 'electris-package.json'

function artifactName(platform, arch) {
  return `electris-v${projectPackage.version}-${platform}-${arch}`
}

function runtimeLayout(artifactPath, platform) {
  if (platform === 'darwin') {
    const contents = path.join(artifactPath, 'electris.app', 'Contents')
    return {
      executable: path.join(contents, 'MacOS', 'electris'),
      asar: path.join(contents, 'Resources', 'app.asar')
    }
  }

  return {
    executable: path.join(artifactPath, platform === 'win32' ? 'electris.exe' : 'electris'),
    asar: path.join(artifactPath, 'resources', 'app.asar')
  }
}

module.exports = {
  appFiles,
  artifactName,
  packageRecordName,
  projectPackage,
  root,
  runtimeLayout,
  targets
}
