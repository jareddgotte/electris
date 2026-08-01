# electris

## Description

An Electron port of [js-tetris](https://github.com/jareddgotte/js-tetris), with TypeScript, React, and webpack. js-tetris is source lineage only; Electris is maintained independently.

## Preview

<kbd><img src="https://raw.githubusercontent.com/jareddgotte/electris/master/static/images/preview.png" alt="Preview of Electris" /></kbd>

## Installing

1. Visit this repo's [Releases](https://github.com/jareddgotte/electris/releases) page.
2. Download the ZIP file for your platform.
3. Extract the folder where you'd like to install the game.
4. Launch the game by executing the **electris** file at the root of the folder.

## Local development

The supported development environment is Node.js 22 (22.13 or newer) and npm 11. npm is the sole package manager; `package-lock.json` is the canonical lockfile and `npm ci` is the frozen install command. The `.nvmrc` file selects Node 22 for nvm users.

```sh
git clone https://github.com/jareddgotte/electris.git
cd electris
npm ci
npm run lint
npm run typecheck
npm run build
npm start
```

The commands are independent: `lint` checks TypeScript/TSX sources, `typecheck` checks without emitting files, `build` removes prior generated entries and creates a production bundle, and `start` launches `app/main.js`. Run `npm run build` before `npm start` after a clean checkout. The VS Code **Launch Electris** configuration performs that build automatically.

Webpack generates `app/main.js`, `app/tetris.js`, `app/renderer.js`, `app/renderer.html`, and source maps. These generated files are ignored by Git; the static `app/css` and `app/img` assets remain tracked.

## Tooling baseline

The maintained baseline uses TypeScript 6 with `ts-loader`, webpack 5's built-in source-map support, HTML Webpack Plugin 5, and ESLint with typescript-eslint. `ts-loader` replaces awesome-typescript-loader, and the build's explicit clean step replaces clean-webpack-plugin. The obsolete hard-source-webpack-plugin cache was removed so builds do not depend on prior cache state. TSLint and its configurations were replaced by ESLint. Unused Standard/standard-loader and PropTypes tooling were removed. webpack-node-externals remains in use to preserve the existing Electron bundle behavior.

Electron and application framework versions are intentionally unchanged in this tooling-only update. In particular, this baseline does not address Electron's known legacy security limitations.

## Contributing

- Pull requests are welcome.
- Use npm only. Commit `package-lock.json` whenever a dependency or manifest change updates it.
- Beware that some code auto-formatting tools conflict with this project's adherence to Google's style guide for [continuation lines](https://google.github.io/styleguide/jsguide.html#formatting-indent).
