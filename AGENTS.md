# Electris project guidance

This is the authoritative repository guide for contributors and coding agents. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull-request workflow.

## Repository map

- `src/main.ts` and `src/main/*.ts`: Electron main-process lifecycle, secure
  window creation, IPC registration, and score persistence.
- `src/preload.ts`: typed isolated bridge exposed to the renderer.
- `src/renderer.tsx` and `src/*.ejs`: renderer UI and HTML templates.
- `src/js/`: gameplay, tetromino logic, and renderer-side bootstrap code.
- `src/electris.ts`: shared bridge and high-score types.
- `app/css/` and `app/img/`: tracked renderer assets.
- `webpack.config.js`: main, preload, and renderer production bundles.
- `package.json`: canonical scripts and supported tool engines.
- `scripts/package-*.cjs`: local package target policy, build orchestration,
  verification, and bounded artifact smoke harness.
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
`app/renderer.js.LICENSE.txt`, `app/renderer.html`, and source maps. They are
ignored and must not be committed.
The assets under `app/css/` and `app/img/` are source files and remain tracked.
Packaging writes ignored, unsigned directory artifacts and temporary work under
`dist/`; failed package attempts remove their target and partial work.

## Canonical commands

Run commands from the repository root:

- `npm ci` — frozen dependency installation.
- `npm test` — run the deterministic, headless behavioral test suite (vitest).
- `npm run lint` — lint TypeScript and TSX sources.
- `npm run typecheck` — type-check without emitting files.
- `npm run docs:check` — validate Markdown structure and repository-relative links.
- `npm run smoke` — clean-build and launch the actual local renderer in Electron,
  exercising the isolated preload, native controls, fixed external mappings, and score
  persistence. On displayless Linux it uses `xvfb-run` and fails clearly if unavailable.
- `npm run build` — clean generated app entries, type-check, and bundle.
- `npm start` — launch the previously built `app/main.js`; build first after a clean checkout.
- `npm run package:host` — clean-build, stage the allowlisted production payload,
  and create only `dist/electris-v<version>-<host-platform>-<host-arch>/`.
- `npm run package:target -- --platform=<platform> --arch=<arch>` — clean-build one
  reviewed explicit target; both arguments are mandatory.
- `npm run package:verify -- dist/electris-v<version>-<platform>-<arch>` — inspect
  package identity, Electron version, executable platform/architecture, launch record,
  required payload, and forbidden content.
- `npm run package:smoke -- dist/electris-v<version>-<platform>-<arch>` — on a
  matching target host, bounded-launch the package twice and record passing startup,
  isolated preload/CSP/navigation, controls, and score-restart evidence.

For source or build configuration changes, run tests, lint, typecheck, smoke,
documentation checks, and build. Add behavioral tests for changed behavior rather
than treating manual checks as a substitute; reuse `test/fixtures/game.ts` when
characterizing production piece or board behavior. Packaging changes additionally
require `package:host`, `package:verify`, and `package:smoke` on a capable matching
host. For documentation-only changes, verify commands and links against the
authoritative files and run code validation when the documentation depends on build
behavior.

Local packaging requires `npm ci` under the declared Node/npm versions and access to
Electron's target runtime download (or its existing local cache). Artifact smoke also
requires the target OS/architecture, Electron's host libraries, and a display; on
headless Linux the harness uses `xvfb-run`. If that host cannot display or start
Electron, copy the unchanged directory to the same `dist/` path in a checkout on a
capable matching host, run `npm ci`, then run the exact `package:verify`,
`package:smoke`, and `package:verify` commands above. Never substitute a direct or
unbounded application launch for the harness.

The reviewed locally buildable target pairs in `scripts/package-config.cjs` are
macOS (`darwin`) arm64/x64, Linux arm64/x64, and Windows (`win32`)
arm64/ia32/x64. A cross-built artifact is only locally inspected and remains recorded
as not launched. A target is locally tested only after `package:smoke` passes on that
exact OS/architecture and updates its package record. There are no supported release
targets or current supported binaries. These commands create unsigned, unpacked local
directories only: they do not ZIP, publish, upload, tag, release, sign, or notarize.
The application payload and source-map policy are the allowlist documented beside the
configuration in `scripts/package-config.cjs`.

## Change discipline

Keep pull requests focused. Correct affected stale documentation in the same PR.
Commit `package-lock.json` whenever an intentional manifest or dependency change
updates it; do not regenerate it for unrelated work. Follow the PR title and
description conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md).

- Automated review workflows can fail silently; confirm that a review comment or
  resolved thread actually appeared instead of trusting a green check.
- `anthropics/claude-code-action` itself validates that a PR's workflow file is
  byte-identical to the default branch's; when it is not, the action skips Claude
  execution even though the job still reports success. A PR that changes
  `.github/workflows/claude-code-review.yml` or `.github/workflows/claude.yml`
  therefore requires inspecting the run logs to confirm Claude actually executed,
  plus manual review and post-merge verification rather than trusting the check
  alone.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
