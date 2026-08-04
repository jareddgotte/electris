# Support

Electris currently has no supported current release.

## Status

- **Historical binaries:** unsupported archival artifacts only.
- **Source development:** supported only for contributors working from the repository.
- **Future release support:** blocked until a separately authorized release proposal records the required evidence and decisions.

## Supported vs unverified targets

A platform/architecture may be described as supported only after:

1. the target is listed in `scripts/package-config.cjs` as a reviewed packaging target; and
2. `npm run package:smoke -- dist/electris-v<version>-<platform>-<arch>` has passed on that exact target OS/architecture.

Anything else is either buildable-only, cross-built, or unverified and must not be described as supported.

## Support window

No support window is currently approved. Do not invent one.

## User assistance

For repository maintenance and release mechanics, follow [`AGENTS.md`](AGENTS.md) and [`RELEASING.md`](RELEASING.md).
