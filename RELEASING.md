# Release readiness and automation

Electris has no current supported release. Historical 2018 assets remain unsupported archives. The release workflows added here automate evidence and guarded drafts; they do not authorize a tag, publish a release, configure GitHub, or remove the readiness gates below.

## Release policy

- An immutable strict-SemVer tag prepares a draft. Ordinary branch pushes, merges, pull requests, forks, comments, and arbitrary SHAs cannot do so.
- Preparation and publication require separate captain authorization. Publication is a manual dispatch that revalidates and publishes the existing draft without rebuilding it.
- `package.json#version` is the single editable version source. Use `npm version --no-git-tag-version <version>` so npm mirrors it into both required lockfile fields, then add `docs/releases/v<version>.md` in the same proposal.
- The failed, unpublished `v0.2.0-rc.1` and `v0.2.0-rc.2` candidates are retained as incident evidence. Any successor version and tag require a separate reviewed proposal and captain authorization; release-automation implementation does not create either.
- Tags use `vX.Y.Z` or strict SemVer prereleases such as `vX.Y.Z-rc.N`. Build metadata and leading-zero forms are rejected. Existing `v0.1.0` through `v0.1.2` are immutable archives and may never be reused.

The full SemVer remains the tag, package, application, notes, record, artifact, manifest, and GitHub Release identity. Native build-version fields use the numeric `X.Y.Z` core because operating-system metadata restricts that field; it is not an independent release version.

## Required identity gate

Before packaging, `npm run release:identity -- --tag=v<version>` requires exact agreement among:

1. `package.json#version`;
2. the top-level and root-package `package-lock.json` versions;
3. the strict tag and its checked-out commit;
4. `docs/releases/v<version>.md`; and
5. ancestry from protected `origin/master`.

It also rejects the archival tags. Before any package job, a dedicated preflight job searches the authenticated paginated release list and rejects a published, conflicting, or non-unique exact-tag Release. GitHub returns draft releases only to a token with push access, so that job alone carries a job-scoped `contents: write` token and sees existing drafts; it lists releases and performs no write. The workflow default and every identity, source, and package job stay read-only. Preparation has no fresh-dispatch recovery trigger. No workflow creates, moves, or deletes tags.

## Pre-tag runner qualification

After `.github/workflows/runner-qualification.yml` is merged to protected `master`, a captain may separately authorize one manual qualification dispatch:

```text
gh workflow run runner-qualification.yml --ref master
```

Do not dispatch it from the implementing pull request. The workflow has no selector inputs, rejects every ref and workflow source except protected `master`, and keeps `GITHUB_TOKEN` read-only. Its four native jobs assert the exact runner platform and architecture, then run `package:host`, package verification, the repository-owned bounded package smoke, and package verification again. They do not enter a release or signing environment, use secrets, create tags or releases, archive packages, or publish anything.

Each successful target uploads only its compact JSON qualification record for seven days; package directories and distributable archives remain runner-local and expire with the job. Review the four job logs, platform/architecture assertions, matching-host smoke results, final verification, commit SHA, and JSON records. Actions run logs follow the repository's bounded retention setting. This evidence qualifies runner availability for the reviewed commit only and does not authorize a tag, draft, publication, or support claim.

## Automated preparation

`.github/workflows/release-prepare.yml` runs only on `v*` tag pushes. The tag glob is
only an event filter; the repository identity script performs strict parsing. The
workflow deliberately has no `workflow_dispatch` trigger: a fresh run rebuilds archive
and manifest provenance and is not byte-identical recovery.

A transient failure may be retried only by rerunning failed jobs in the **same workflow
run**, while its retained artifacts are still available:

```text
run_id=<authorized-prepare-run-id>
gh run rerun "$run_id" --repo jareddgotte/electris --failed
```

A rerun attempt keeps `github.run_id`, reuses artifacts from package jobs that already
succeeded, and reruns failed jobs and their dependents. It must not be replaced by
`gh workflow run` or another tag event. If the required artifacts have expired or the
same run cannot be retried safely, stop and use a corrected, separately authorized
successor version/tag.

The workflow:

1. validates identity and requires at most one exact-tag Release from the authenticated paginated release list;
2. runs frozen source validation and the bounded source smoke;
3. natively packages, verifies, bounded-smokes, verifies again, archives, freshly extracts, and verifies Linux x64, Windows x64, macOS arm64, and macOS x64;
4. retains all four target archives as short-lived workflow qualification evidence;
5. assembles the exact public asset set only after every target succeeds; and
6. creates or idempotently completes at most one **draft** GitHub Release.

Only the draft-discovery preflight job and draft assembly receive `contents: write`,
each job-scoped; the preflight token exists solely so draft releases are visible to
discovery. Per-tag concurrency does not cancel an in-progress release. Discovery
includes drafts, requires an exact `tag_name`, and fails on multiple candidates.
Because offset pagination can duplicate or skip a release when the list changes
mid-walk, discovery repeats the complete list and acts only after two consecutive
snapshots agree on the same ordered, duplicate-free release IDs; sustained churn
fails the operation instead of selecting from an unstable list. After creation,
synchronization rechecks exact-tag uniqueness and the created release ID before any
asset upload and again before reporting success. Existing assets are downloaded and
hash-compared before any missing asset is written; missing assets are uploaded, while
unexpected or different bytes stop the run. Raw `dist/` directories are never uploaded.

Preparation still contains two inert-by-default, fail-only repository-variable canary
hooks hard-coded to `v0.2.0-rc.2`. Both variables are absent. The rc.2 partial-upload
and fresh-dispatch incident disproved the old recovery procedure, and the immutable
rc.2 tag cannot acquire this correction. Do not set either rc.2 value or rerun either
rc workflow. The preserved rc.1/rc.2 evidence and successor-only operator contract are
in [`docs/release-administration.md`](docs/release-administration.md).

Linux's workflow AppArmor profiles grant `userns` only to the exact installed or packaged Electron executable and do not disable Electron's sandbox. All Electron launches use repository-owned bounded smoke harnesses.

## Assets and target policy

Initial public assets are unsigned portable packages, not installers:

```text
electris-v<V>-linux-x64-portable.tar.gz
electris-v<V>-win32-x64-portable.zip
electris-v<V>-release-manifest.json
electris-v<V>-SHA256SUMS.txt
```

Each archive contains one `electris-v<V>-<platform>-<arch>/` directory. The manifest records exact tag/commit/package/Electron/workflow/target/smoke/signing identity; every target must identify the same prepare `github.run_id`. `SHA256SUMS.txt` is bytewise sorted and covers both public archives and the manifest, but not itself.

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

After environment approval, it revalidates tag/package/lock/note/ancestry identity, requires one exact-tag draft from the authenticated paginated release list, binds verification and publication to that release ID, downloads every asset, rejects missing/extra/different assets, and verifies manifest and checksums. It publishes only when the manifest names one successful tag-push prepare run for the exact commit, after a final uniqueness, release-ID, and asset-inventory check. It never rebuilds or replaces bytes. Prereleases remain prereleases and do not replace the latest stable release; a stable release becomes latest.

Before authorizing publication, manually review the committed notes, prepare run, target evidence, exact draft downloads, unsigned warnings, and every readiness gate. After publication, download the public assets, recheck SHA-256, extract/verify, and run the bounded package smoke on each claimed host.

## Failure recovery and rollback

- A failed required platform leaves no newly assembled asset set. Rerun failed jobs only within that same tag-push workflow run so successful package artifacts and `github.run_id` provenance are reused. Do not start a fresh preparation run as recovery.
- Partial draft assembly first requires one exact-tag release ID and validates every existing expected asset, then adds missing assets and accepts byte-identical assets only. Different bytes, extras, duplicate candidates, or a changed release ID require investigation; there is no clobber path.
- A source, version, note, package, tagged workflow defect, expired artifact, or unrecoverable run requires a corrected pull request and a new SemVer/tag. A newer default-branch workflow cannot repair an old tag. Never move or delete an old tag to hide the failure. The failed, unpublished `v0.2.0-rc.1` and duplicate-draft `v0.2.0-rc.2` incidents are retained under this rule and must not be rerun or published.
- Keep bad drafts unpublished. If a release was published, mark it withdrawn/deprecated, retain incident hashes and evidence, and supersede it with a new version. Never silently replace published bytes. Desktop downloads cannot be remotely rolled back.
- Enable GitHub immutable releases only after a separately authorized successor prerelease canary proves matrix failure, same-run partial-upload recovery, exact-tag uniqueness, no-upload retry, draft download verification, and publication controls.

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

`release:github` is workflow plumbing for paginated exact-tag preflight, same-run byte-idempotent draft synchronization, and publish-only revalidation bound to one release ID. It must not be used to bypass captain authorization or protected environments.
