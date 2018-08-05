const electron = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

/**
 * Provides a way to store data to the user's app data folder. Based off of:
 *   https://gist.github.com/ccnokes/95cb454860dbf8577e88d734c3f31e08
 */
export class Store {
  private configPath: string
  private data: any

  constructor(opts: StoreOpts) {
    // Get the user's relative app data directory path (the renderer process has
    // to get `app` module via `remote`, whereas the main process can get it
    // directly)
    const app = electron.app || electron.remote.app
    const userDataPath = app.getPath('userData')
    const configFileName = 'Electris.' + opts.configName + '.dat'
    // Set the config path based on the user's app data directory and
    // `configName` property
    this.configPath = path.join(userDataPath, configFileName)

    // Load any pre-existing data
    this.data = this.parseDataFile(this.configPath, opts.defaults)

    // console.log('Store initialized: ', this.configPath, this.data) // debug
  }

  // Return requested property of the `this.data` object
  get(key: string) {
    // console.log(`Store[get]; key[${key}]`, this.data) // debug
    return this.data[key]
  }

  // Save and compress JSON values associated with given key to disk
  set(key: string, val: any) {
    // console.log(`Store[set]; key[${key}]`, val) // debug
    this.data[key] = val

    const bufferedJSON = new Buffer(JSON.stringify(this.data))
    // console.log('bufferedJSON', bufferedJSON) // debug

    zlib.deflate(bufferedJSON, (err: string, buf: string) => {
      // console.log('deflate async', err, buf) // debug
      if (err) console.error('zlib deflate error:', err)

      try {
        fs.writeFileSync(this.configPath, buf)
      } catch (error) {
        console.error('Couldn\'t save data:', error)
      }
    })
  }

  // Decompress and unstringify saved JSON data
  private parseDataFile(filePath: string, defaults: any) {
    // console.log('parsing data file') // debug
    try {
      const inflatedBuffer = zlib.inflateSync(fs.readFileSync(filePath))
      const decodedValue = inflatedBuffer.toString()

      // console.log('inflate sync', inflatedBuffer, decodedValue) // debug
      return JSON.parse(decodedValue)
    } catch (error) {
      // Load defaults if file doesn't already exist (or otherwise fails)
      // console.log('defaults', error) // debug
      return defaults
    }
  }
}