# Electris project guidance

This is the authoritative repository guide for contributors and coding agents. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull-request workflow.

## Repository map

- `src/main/*.ts`: Electron main-process lifecycle, secure window creation, IPC
  registration, and score persistence.
- `src/preload.ts`: typed isolated bridge exposed to the renderer.
- `src/renderer.tsx` and `src/*.ejs`: renderer UI and HTML templates.
- `src/js/`: gameplay, tetromino logic, and renderer-side bootstrap code.
- `src/electris.ts`: shared bridge and high-score types.
- `app/css/` and `app/img/`: tracked renderer assets.
- `webpack.config.js`: main, preload, and renderer production bundles.
- `package.json`: canonical scripts and supported tool engines.
- `.github/pull_request_template.md`: required PR description structure.
- `.github/workflows/pull-request.yml`: least-privilege pull-request CI (lint,
  typecheck, tests, smoke, documentation check, build).
- `test/fixtures/game.ts`: reusable fixtures for characterizing production piece and
  board behavior; provides deterministic runtime dependencies and board fixtures.

## Source provenance

[js-tetris](https://github.com/jareddgotte/js-tetris) is source provenance only,
not a repository to synchronize. Semantically evaluate its behavior and selectively
port only what applies to Electris. Never synchronize the repositories wholesale,
copy its guidance, or import commits by assumption.

## Architecture and invariants

- The main process owns application lifecycle, native `BrowserWindow` creation,
  IPC validation, external links, and score persistence.
- The preload layer exposes only the typed `window.electris` bridge.
- The renderer owns React rendering, browser events, canvas gameplay, and the current
  game orchestration.
- Treat established board dimensions, piece movement/rotation/collision, line
  clearing, scoring, pause/restart behavior, and high-score behavior as gameplay
  engine invariants unless a focused change intentionally revises them.
- Preserve the process boundary and gameplay semantics during unrelated work.
  Changed behavior requires behavioral tests.
- Node and npm versions must satisfy `package.json#engines`; `.nvmrc` selects the
  supported Node major. npm is the only package manager, and `package-lock.json` is
  the canonical lockfile.

## Generated files

`npm run build` generates `app/main.js`, `app/preload.js`, `app/renderer.js`,
`app/renderer.html`, and source maps. They are ignored and must not be committed.
The assets under `app/css/` and `app/img/` are source files and remain tracked.
Packaging writes ignored artifacts under `dist/`.

## Canonical commands

Run commands from the repository root:

- `npm ci` — frozen dependency installation.
- `npm test` — run the deterministic, headless behavioral test suite (vitest).
- `npm run lint` — lint TypeScript and TSX sources.
- `npm run typecheck` — type-check without emitting files.
- `npm run docs:check` — validate Markdown structure and repository-relative links.
- `npm run smoke` — run the Electron security/contract smoke suite.
- `npm run build` — clean generated app entries, type-check, and bundle.
- `npm start` — launch the previously built `app/main.js`; build first after a clean checkout.
- `npm run package` — create local macOS, Linux, and Windows package artifacts, then
  ZIP them through the npm `postpackage` lifecycle.

For source or build configuration changes, run tests, lint, typecheck, smoke,
documentation checks, and build. Add behavioral tests for changed behavior rather
than treating manual checks as a substitute; reuse `test/fixtures/game.ts` when
characterizing production piece or board behavior. For documentation-only changes,
verify commands and links against the authoritative files and run code validation
when the documentation depends on build behavior.

Run `npm run package` only when packaging is affected or explicitly requested: it is
slower, may download platform runtimes, requires a local `zip` executable, and
creates all supported platform outputs. It does not publish, release, or sign them.
Use `npm start` for a manual smoke check when UI or Electron integration changes and
the environment can display the application.

## Change discipline

Keep pull requests focused. Correct affected stale documentation in the same PR.
Commit `package-lock.json` whenever an intentional manifest or dependency change
updates it; do not regenerate it for unrelated work. Follow the PR title and
description conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md).

- Automated review workflows can fail silently; confirm that a review comment or
  resolved thread actually appeared instead of trusting a green check.
- The reviewer workflow refuses to run when the PR changes a workflow file; see
  the inline comments in [`.github/workflows/claude-code-review.yml`](.github/workflows/claude-code-review.yml)
  and [`.github/workflows/claude.yml`](.github/workflows/claude.yml) for the exact
  guard and publication limits.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
