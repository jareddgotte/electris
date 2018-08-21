# electris
## Description
Migrating the web browser version of my Tetris game ([js-tetris](https://github.com/jareddgotte/js-tetris)) to Electron with the end goal of incorporating linting, TypeScript, React, SASS, webpack, and yarn.

## Preview
<kbd><img src="https://raw.githubusercontent.com/jareddgotte/electris/master/static/images/preview.png" alt="Preview of Electris" /></kbd>

## Installing
1. Visit this repo's [Releases](https://github.com/jareddgotte/electris/releases) page
2. Download the ZIP file for your platform
3. Extract the folder where you'd like to install the game
4. Launch the game by executing the **electris** file at the root of the folder

## Building
1. Clone this git repo; e.g.:
   - `git clone --depth=1 https://github.com/jareddgotte/electris.git`
2. Do `yarn install` or `npm install` to populate the local "./node_modules" folder
3. Do `yarn build` or `npm run build` to compile/transpile the relevant "./src" files
4. Then do `yarn start` or `npm start` to launch the game
   - *(Alternatively, if you open up the project in VSCode, you can just press F5 to complete steps 3 and 4 using yarn)*

## Contributing
* Pull requests (PR) are welcome
* Please do not include any changes to lock files unless your PR requires it
* Beware that some code auto-formatting tools conflict with this project's adherence to the Google's style guide on handling [continuation lines](https://google.github.io/styleguide/jsguide.html#formatting-indent)
