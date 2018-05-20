const path = require('path')
const fs = require('fs')
const nodeExternals = require('webpack-node-externals')
const { CheckerPlugin } = require('awesome-typescript-loader')
const CleanWebpackPlugin = require('clean-webpack-plugin')
const HardSourceWebpackPlugin = require('hard-source-webpack-plugin')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')

const rendererEntries =
  fs.readdirSync('src')
    .filter(f => f.match(/.*\.tsx$/))
    .map(f => path.join('src', f))
    .reduce((memo, file) => {
      memo[path.basename(file, path.extname(file))] = path.resolve(file)
      return memo
    }, {})

const commonConfig = {
  mode: 'production',
  // mode: 'development',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.ts', '.tsx']
  },
  node: {
    __dirname: false
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'awesome-typescript-loader',
            options: {
              typeCheck: true,
              emitErrors: true,
              colors: true,
              useCache: true,
              forceIsolatedModules: true,
              reportFiles: ['./src/**/*.{ts,tsx}']
            }
          }
        ]
      }
    ]
  }
}

module.exports = [
  Object.assign({
    target: 'electron-main',
    entry: {
      main: './src/main.ts',
      tetris: './src/js/tetris.ts'
    },
    externals: [nodeExternals()],
    plugins: [
      new CheckerPlugin(),
      new CleanWebpackPlugin(['./dist/'], {
        exclude: ['main.d.ts', 'renderer.d.ts', 'js'],
        verbose: true
      }),
      new HardSourceWebpackPlugin(),
      new webpack.SourceMapDevToolPlugin({
        filename: '[name].js.map'
      })
    ]
  }, commonConfig),
  Object.assign({
    target: 'electron-renderer',
    entry: rendererEntries,
    externals: [nodeExternals()],
    plugins: [
      new CheckerPlugin(),
      new HardSourceWebpackPlugin(),
      new webpack.SourceMapDevToolPlugin({
        filename: '[name].js.map'
      }),
      ...Object.keys(rendererEntries).map(k =>
        new HtmlWebpackPlugin({
          filename: `${k}.html`,
          chunks: [k],
          template: fs.existsSync(`src/${k}.ejs`)
            ? `src/${k}.ejs`
            : 'src/default.ejs'
        }))
    ]
  }, commonConfig)
]
