import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import webpack from 'webpack'

const require = createRequire(import.meta.url)
const webpackConfigs = require('../webpack.config.js') as Array<Record<string, any>>
let outputDirectory = ''
let rendererHtml = ''
let rendererJavaScript = ''

beforeAll(async () => {
  outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'electris-renderer-'))
  const rendererConfig = webpackConfigs.find((config) => config.name === 'renderer')
  if (!rendererConfig) throw new Error('Renderer webpack configuration is missing')

  const compiler = webpack({
    ...rendererConfig,
    output: {
      ...rendererConfig.output,
      path: outputDirectory
    }
  })

  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) {
          reject(error)
          return
        }
        if (!stats || stats.hasErrors()) {
          reject(new Error(stats?.toString({all: false, errors: true})))
          return
        }
        resolve()
      })
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      compiler.close((error) => error ? reject(error) : resolve())
    })
  }

  ;[rendererHtml, rendererJavaScript] = await Promise.all([
    fs.readFile(path.join(outputDirectory, 'renderer.html'), 'utf8'),
    fs.readFile(path.join(outputDirectory, 'renderer.js'), 'utf8')
  ])
}, 20_000)

afterAll(async () => {
  if (outputDirectory) await fs.rm(outputDirectory, {recursive: true, force: true})
})

describe('production renderer security policy', () => {
  it('emits the reviewed restrictive CSP', () => {
    const cspMatch = rendererHtml.match(
        /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
    expect(cspMatch).not.toBeNull()

    const directives = Object.fromEntries(
        (cspMatch?.[1] ?? '').split(';').map((directive) => directive.trim()).filter(Boolean)
            .map((directive) => {
              const [name, ...sources] = directive.split(/\s+/)
              return [name, sources]
            }))

    expect(directives).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'"],
      'connect-src': ["'none'"],
      'object-src': ["'none'"],
      'frame-src': ["'none'"],
      'media-src': ["'none'"],
      'worker-src': ["'none'"],
      'manifest-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"]
    })

    const policy = cspMatch?.[1] ?? ''
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|data:|https?:|\*/)
  })

  it('uses only external local scripts and styles without eval', () => {
    expect(rendererHtml).toMatch(/<script defer="defer" src="renderer\.js"><\/script>/)
    expect(rendererHtml).toMatch(/<link rel="stylesheet" href="css\/main\.css">/)
    expect(rendererHtml).not.toMatch(/<script(?![^>]+\bsrc=)[^>]*>/)
    expect(rendererHtml).not.toMatch(/\sstyle=|\son[a-z]+=/i)
    expect(rendererJavaScript).not.toMatch(/\beval\s*\(|\bnew Function\s*\(/)
  })
})
