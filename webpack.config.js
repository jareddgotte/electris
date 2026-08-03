const fs = require('fs')
const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const nodeExternals = require('webpack-node-externals')

const rendererEntries = fs.readdirSync(path.resolve(__dirname, 'src'))
  .filter(file => file.endsWith('.tsx'))
  .reduce((entries, file) => {
    entries[path.basename(file, path.extname(file))] = path.resolve(__dirname, 'src', file)
    return entries
  }, {})

const commonConfig = {
  mode: 'production',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'app'),
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true
          }
        }
      }
    ]
  }
}

module.exports = [
  {
    ...commonConfig,
    name: 'main',
    target: 'electron-main',
    entry: {
      main: './src/main.ts',
      preload: './src/preload.ts'
    },
    externals: [nodeExternals()]
  },
  {
    ...commonConfig,
    name: 'renderer',
    target: 'electron-renderer',
    entry: rendererEntries,
    plugins: Object.keys(rendererEntries).map(name =>
      new HtmlWebpackPlugin({
        filename: `${name}.html`,
        chunks: [name],
        template: fs.existsSync(path.resolve(__dirname, 'src', `${name}.ejs`))
          ? path.resolve(__dirname, 'src', `${name}.ejs`)
          : path.resolve(__dirname, 'src', 'default.ejs')
      })
    )
  }
]
