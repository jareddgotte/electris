# Release readiness and automation

Electris has no current supported release. Historical 2018 assets remain unsupported archives. The release workflows added here automate evidence and guarded drafts; they do not authorize a tag, publish a release, configure GitHub, or remove the readiness gates below.

## Release policy

- An immutable strict-SemVer tag prepares a draft. Ordinary branch pushes, merges, pull requests, forks, comments, and arbitrary SHAs cannot do so.
- Preparation and publication require separate captain authorization. Publication is a manual dispatch that revalidates and publishes the existing draft without rebuilding it.
- `package.json#version` is the single editable version source. Use `npm version --no-git-tag-version <version>` so npm mirrors it into both required lockfile fields, then add `docs/releases/v<version>.md` in the same proposal.
- The next approved channel is `0.2.0-rc.1`, followed by `0.2.0`. Creating either tag is a separately authorized operation and is not part of release-automation implementation.
- Tags use `vX.Y.Z` or strict SemVer prereleases such as `vX.Y.Z-rc.N`. Build metadata and leading-zero forms are rejected. Existing `v0.1.0` through `v0.1.2` are immutable archives and may never be reused.

The full SemVer remains the tag, package, application, notes, record, artifact, manifest, and GitHub Release identity. Native build-version fields use the numeric `X.Y.Z` core because operating-system metadata restricts that field; it is not an independent release version.

## Required identity gate

Before packaging, `npm run release:identity -- --tag=v<version>` requires exact agreement among:

1. `package.json#version`;
2. the top-level and root-package `package-lock.json` versions;
3. the strict tag and its checked-out commit;
4. `docs/releases/v<version>.md`; and
5. ancestry from protected `origin/master`.

It also rejects the archival tags. The prepare workflow separately rejects an existing published or conflicting GitHub Release before any package job runs. A recovery dispatch accepts only an already existing tag. No workflow creates, moves, or deletes tags.

## Pre-tag runner qualification

After `.github/workflows/runner-qualification.yml` is merged to protected `master`, a captain may separately authorize one manual qualification dispatch:

```text
gh workflow run runner-qualification.yml --ref master
```

Do not dispatch it from the implementing pull request. The workflow has no selector inputs, rejects every ref and workflow source except protected `master`, and keeps `GITHUB_TOKEN` read-only. Its four native jobs assert the exact runner platform and architecture, then run `package:host`, package verification, the repository-owned bounded package smoke, and package verification again. They do not enter a release or signing environment, use secrets, create tags or releases, archive packages, or publish anything.

Each successful target uploads only its compact JSON qualification record for seven days; package directories and distributable archives remain runner-local and expire with the job. Review the four job logs, platform/architecture assertions, matching-host smoke results, final verification, commit SHA, and JSON records. Actions run logs follow the repository's bounded retention setting. This evidence qualifies runner availability for the reviewed commit only and does not authorize a tag, draft, publication, or support claim.

## Automated preparation

`.github/workflows/release-prepare.yml` runs on `v*` tag pushes and recovery-only
manual dispatch. The tag glob is only an event filter; the repository identity script
performs strict parsing. A separately authorized manual recovery must select the same
existing tag as both the workflow ref and input so the workflow version, run head, and
release identity remain aligned:

```text
gh workflow run release-prepare.yml --ref v<version> -f tag=v<version>
```

The workflow rejects a branch ref or a different tag before checkout. The workflow:

1. validates identity and checks for a conflicting release;
2. runs frozen source validation and the bounded source smoke;
3. natively packages, verifies, bounded-smokes, verifies again, archives, freshly extracts, and verifies Linux x64, Windows x64, macOS arm64, and macOS x64;
4. retains all four target archives as short-lived workflow qualification evidence;
5. assembles the exact public asset set only after every target succeeds; and
6. creates or idempotently completes a **draft** GitHub Release.

Only draft assembly receives `contents: write`. Per-tag concurrency does not cancel an in-progress release. Existing assets are downloaded and hash-compared before any missing asset is written; missing assets are uploaded, while unexpected or different bytes stop the run. Raw `dist/` directories are never uploaded.

Preparation contains two inert-by-default, fail-only repository-variable canary hooks
hard-coded to `v0.2.0-rc.1`: one exact `linux-x64` target failure and one stop after a
single successful expected-asset upload. They cannot select another tag or target and
are absent from publication. The target-failure hook ran for rc.1; the partial-upload
hook and recovery dispatches did not. Both temporary variables were removed. Their
exact lifecycle, proven evidence, and failed-tag disposition are in
[`docs/release-administration.md`](docs/release-administration.md).

Linux's workflow AppArmor profiles grant `userns` only to the exact installed or packaged Electron executable and do not disable Electron's sandbox. All Electron launches use repository-owned bounded smoke harnesses.

## Assets and target policy

Initial public assets are unsigned portable packages, not installers:

```text
electris-v<V>-linux-x64-portable.tar.gz
electris-v<V>-win32-x64-portable.zip
electris-v<V>-release-manifest.json
electris-v<V>-SHA256SUMS.txt
```

Each archive contains one `electris-v<V>-<platform>-<arch>/` directory. The manifest records exact tag/commit/package/Electron/workflow/target/smoke/signing identity. `SHA256SUMS.txt` is bytewise sorted and covers both public archives and the manifest, but not itself.

The macOS x64 and arm64 ZIPs are qualification-only workflow artifacts while unsigned. They are represented in the manifest but deliberately absent from the GitHub Release asset set, so publishing a draft cannot accidentally expose them. Source maps, source, tests, development dependencies, caches, and secret-like files are forbidden; required project and Electron notices remain in packages.

Checksums establish downloaded-byte integrity only. They are not publisher signatures, provenance, or reproducibility claims. GitHub's generated source archives are not Electris distributables.

## Signing and user trust

- **Linux x64:** unsigned portable archives may initially publish with truthful notes and SHA-256 evidence.
- **Windows x64:** unsigned portable archives may initially publish. Users can see SmartScreen or “Unknown Publisher”; checksums do not remove that warning. Future Authenticode work requires a separately approved certificate or managed-signing design.
- **macOS x64/arm64:** public assets are blocked until every nested component is Developer ID signed with hardened runtime, notarized by Apple, stapled, verified by `codesign`, notary tooling and Gatekeeper assessment, and then smoke-tested before final archival and hashing. Do not tell users to bypass Gatekeeper.

The future signing job must use a protected `release-signing` environment. Expected environment-only secret names are `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, and `APPLE_API_KEY_P8_BASE64`. Temporary keychains/passwords are job-generated and destroyed. Windows exportable-certificate names, if that model is approved, are `WINDOWS_CERTIFICATE_PFX_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`; OIDC managed signing is preferable. No credential currently exists in repository automation, and no signed status is inferred.

Signing/notarization must occur before final smoke, archive, manifest, and checksum generation. Adding those steps requires focused executable code, tests, and credential-owner approval; documentation is not a signing implementation.

## Manual publication

`.github/workflows/release-publish.yml` accepts only an existing tag and an exact `publish <tag>` confirmation. Its sole job uses the protected `release-publish` environment and is the only publication path with `contents: write`.

After environment approval, it revalidates tag/package/lock/note/ancestry identity, downloads every draft asset from GitHub, rejects missing/extra/different assets, verifies manifest and checksums, and publishes without rebuilding or replacing bytes. Prereleases remain prereleases and do not replace the latest stable release; a stable release becomes latest.

Before authorizing publication, manually review the committed notes, prepare run, target evidence, exact draft downloads, unsigned warnings, and every readiness gate. After publication, download the public assets, recheck SHA-256, extract/verify, and run the bounded package smoke on each claimed host.

## Failure recovery and rollback

- A failed required platform leaves no assembled or published release. Rerun transient failures against the same immutable tag.
- Partial draft assembly first validates every existing expected asset, then adds missing assets and accepts byte-identical assets only. Different bytes or extras require investigation; there is no clobber path.
- A source, version, note, package, or tagged workflow defect requires a corrected
  pull request and a new SemVer/tag (`rc.2` or a patch). A newer default-branch
  workflow cannot repair an old tag: selecting the old tag runs its workflow version,
  while selecting the newer branch changes the prepare run head rejected by
  publication. Never move or delete the old tag to hide it. The failed, unpublished
  `v0.2.0-rc.1` canary is retained under this rule and has no recovery dispatch.
- Keep bad drafts unpublished. If a release was published, mark it withdrawn/deprecated, retain incident hashes and evidence, and supersede it with a new version. Never silently replace published bytes. Desktop downloads cannot be remotely rolled back.
- Enable GitHub immutable releases only after an authorized prerelease canary proves matrix failure, partial-upload recovery, duplicate preparation, draft download verification, and publication controls.

## Readiness blockers

Automation is not permission to claim a supported release. Before public release:

- resolve or explicitly disposition dependency-audit findings;
- complete focused icon, branding, and trademark review;
- enable the approved GitHub private vulnerability-reporting route;
- confirm hosted-runner labels/capacity and matching-host smoke evidence;
- configure protected environments, tag rules, and least-privilege repository settings described in [`docs/release-administration.md`](docs/release-administration.md);
- record preparation and separate publication authorization; and
- for macOS, implement and prove signing/notarization with captain-owned credentials.

Newest stable release support, once one is actually authorized and published, is best effort with no response-time SLA. Until then, [`SUPPORT.md`](SUPPORT.md) and [`SECURITY.md`](SECURITY.md) remain explicit that no supported release exists.

## Local commands

The release-contract commands are:

- `npm run release:identity -- --tag=v<version>`
- `npm run release:archive -- --artifact=<path> --output=<path> --tag=<tag> --commit=<sha> --run-id=<id> --run-url=<url>`
- `npm run release:assemble -- --input=<staging> --output=<release> --tag=<tag> --commit=<sha>`
- `npm run release:verify-assets -- --dir=<release> --tag=<tag> --commit=<sha>`

`release:github` is workflow plumbing for preflight, idempotent draft synchronization, and publish-only revalidation. It must not be used to bypass captain authorization or protected environments.
