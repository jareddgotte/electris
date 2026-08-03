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

## Security architecture

The renderer trust boundary contains only the packaged `renderer.html`, JavaScript,
stylesheet, and image assets. Production HTML carries this Content Security Policy:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

The main process allows the window to load only its exact packaged renderer URL,
blocks redirects, and denies every popup or new-window request. External links never
navigate the Electris window: the isolated preload bridge accepts only the semantic
`author` and `license` destinations, which the main process maps respectively to
`https://www.jaredgotte.com/` and `https://opensource.org/licenses/ISC` for the system
browser. It exposes no arbitrary URL capability.

## Local development and contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started. The authoritative repository
layout, architecture notes, supported environment, commands, generated-file rules,
and validation expectations are maintained in [`AGENTS.md`](AGENTS.md).
