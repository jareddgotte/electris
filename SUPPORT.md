# Support

Electris currently has no supported release.

## Status

- **Historical binaries:** unsupported archival artifacts only.
- **Source development:** supported only for contributors working from the repository.
- **Future release support:** blocked until a separately authorized release proposal satisfies [`RELEASING.md`](RELEASING.md).

Release automation qualifies Linux x64, Windows x64, macOS arm64, and macOS x64 on matching native hosts, but automation and workflow artifacts are not support claims. Initially approved public packages are unsigned Linux x64 and Windows x64 portable archives. macOS remains qualification-only until Developer ID signing and Apple notarization are implemented and verified.

## Supported vs qualified targets

A platform/architecture may be described as supported only after:

1. it is in the committed public release policy;
2. `npm run package:smoke -- dist/electris-v<version>-<platform>-<arch>` passes on that exact target;
3. the final downloaded release asset passes checksum, extraction, package verification, and matching-host bounded smoke; and
4. every security, signing, branding, and release-authorization gate applicable to it is complete.

Anything else is buildable-only, cross-built, unlaunched, qualification-only, or unsupported. In particular, the release manifest's macOS qualification records do not make unsigned macOS packages public or supported.

## Support window

Once a stable release is authorized and published, Electris supports only the newest stable release, on a best-effort basis with no response-time SLA. Prereleases are evaluation candidates, not supported stable releases. Superseded versions and the 2018 assets are unsupported.

Because no current stable release has passed the readiness gates, this approved future window does not create a present support claim.

## User assistance

For repository maintenance and release mechanics, follow [`AGENTS.md`](AGENTS.md) and [`RELEASING.md`](RELEASING.md). Do not put sensitive vulnerability details in public support requests; follow [`SECURITY.md`](SECURITY.md).
