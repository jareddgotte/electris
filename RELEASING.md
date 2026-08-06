# Release readiness and automation

Electris has no current supported release. Historical 2018 assets remain unsupported archives. The release workflows added here automate evidence and guarded drafts; they do not authorize a tag, publish a release, configure GitHub, or remove the readiness gates below.

## Release policy

- An immutable strict-SemVer tag prepares a draft. Ordinary branch pushes, merges, pull requests, forks, comments, and arbitrary SHAs cannot do so.
- Preparation and publication require separate captain authorization. Publication is a manual dispatch that revalidates and publishes the existing draft without rebuilding it.
- `package.json#version` is the single editable version source. Use `npm version --no-git-tag-version <version>` so npm mirrors it into both required lockfile fields, then add `docs/releases/v<version>.md` in the same proposal.
- The failed, unpublished `v0.2.0-rc.1` and `v0.2.0-rc.2` candidates are retained as incident evidence. `v0.2.0-rc.3` is the currently proposed successor candidate: a committed version and note only, with no tag, workflow run, draft, GitHub Release, or asset set. Any successor version and tag require a separate reviewed proposal and captain authorization; release-automation implementation does not create either.
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
asset upload and again before reporting success.

That list is eventually consistent, and GitHub does not document the lag. A create
response is authoritative for existence; the release list is authoritative only for
uniqueness. So once a release ID is held, a list that omits it is stale rather than
evidence the release is gone: rediscovery retries on a bounded escalating schedule of
six attempts across 23 seconds, well past the longest lag observed here or upstream.
Every other outcome stays immediately fatal and unretried — a different exact-tag
release ID, multiple exact-tag matches, and sustained list churn — and exhausting the
schedule fails closed with no upload, leaving a draft that a same-run rerun completes.

Existing assets are downloaded and hash-compared before any missing asset is written;
missing assets are uploaded, while unexpected or different bytes stop the run. Raw
`dist/` directories are never uploaded.

Assembly also refuses, before it discovers or creates anything, while any
`release-publish.yml` run for the exact tag has not reached a terminal status —
including one still waiting for environment approval. The refusal names each such run
and its status, and it never reports success. It reads workflow runs only; the job
carries `actions: read` alongside its existing `contents: write` for that reason. This
is deliberately a refusal and not a queue: publication has priority, because a refused
assembly is recoverable by rerunning that same run while a cancelled or superseded
publication needs fresh authorization. The operator's remedy is to cancel the
unapproved publication run or to wait for it to be approved and complete; both are
visible acts. See "Concurrent preparation and publication" below.

Preparation still contains two inert-by-default, fail-only repository-variable canary
hooks hard-coded to `v0.2.0-rc.2`. Both variables are absent. The rc.2 partial-upload
and fresh-dispatch incident disproved the old recovery procedure, and the immutable
rc.2 tag cannot acquire this correction. Do not set either rc.2 value or rerun either
rc workflow. The proposed `v0.2.0-rc.3` candidate does not retarget these hooks; a
successor canary is a separate focused change. The preserved rc.1/rc.2 evidence and
successor-only operator contract are in
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

Each archive contains one `electris-v<V>-<platform>-<arch>/` directory. The manifest records exact tag/commit/package/Electron/workflow/target/smoke/signing identity; every target must identify the same prepare `github.run_id`. `SHA256SUMS.txt` is bytewise sorted and covers both public archives and the manifest, but not itself.

The macOS x64 and arm64 ZIPs are qualification-only workflow artifacts while unsigned. They are represented in the manifest but deliberately absent from the GitHub Release asset set, so publishing a draft cannot accidentally expose them. Source maps, source, tests, development dependencies, caches, and secret-like files are forbidden; required project and Electron notices remain in packages.

Checksums establish downloaded-byte integrity only. They are not publisher signatures, provenance, or reproducibility claims. GitHub's generated source archives are not Electris distributables.

An operator must be able to verify any published archive from any checkout, so `.gitattributes` normalizes tracked text to LF and `package:verify` accepts a CRLF/LF-only difference for the assets `scripts/package-config.cjs` declares `newlineInsensitive`, while every other verified asset stays a strict byte comparison. Published `v0.2.0-rc.3` predates that correction: its Windows archive embeds CRLF copies of `css/main.css` and `LICENSE`, so verifying it needs this repository at or after the fix. Those bytes still match `SHA256SUMS.txt` and the manifest exactly and are never replaced.

## Signing and user trust

- **Linux x64:** unsigned portable archives may initially publish with truthful notes and SHA-256 evidence.
- **Windows x64:** unsigned portable archives may initially publish. Users can see SmartScreen or “Unknown Publisher”; checksums do not remove that warning. Future Authenticode work requires a separately approved certificate or managed-signing design.
- **macOS x64/arm64:** public assets are blocked until every nested component is Developer ID signed with hardened runtime, notarized by Apple, stapled, verified by `codesign`, notary tooling and Gatekeeper assessment, and then smoke-tested before final archival and hashing. Do not tell users to bypass Gatekeeper.

The future signing job must use a protected `release-signing` environment. Expected environment-only secret names are `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, and `APPLE_API_KEY_P8_BASE64`. Temporary keychains/passwords are job-generated and destroyed. Windows exportable-certificate names, if that model is approved, are `WINDOWS_CERTIFICATE_PFX_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`; OIDC managed signing is preferable. No credential currently exists in repository automation, and no signed status is inferred.

Signing/notarization must occur before final smoke, archive, manifest, and checksum generation. Adding those steps requires focused executable code, tests, and credential-owner approval; documentation is not a signing implementation.

## Manual publication

`.github/workflows/release-publish.yml` accepts only an existing tag and an exact `publish <tag>` confirmation. Its sole job uses the protected `release-publish` environment and is the only publication path with `contents: write`.

After environment approval, it revalidates tag/package/lock/note/ancestry identity, requires one exact-tag draft from the authenticated paginated release list, binds verification and publication to that release ID, downloads every asset, rejects missing/extra/different assets, and verifies manifest and checksums. It publishes only when the manifest names one allowed tag-push prepare run for the exact commit that reached a successful conclusion, after a final uniqueness, release-ID, and asset-inventory check.

Because the recovery path deliberately reruns the same run, that run's success is judged per attempt rather than by its latest attempt alone. GitHub's run object reports only the latest attempt, so a later rerun that fails would otherwise permanently block a complete draft an earlier attempt of the same run assembled. Publication accepts a successful conclusion on **any** attempt of the manifest's run, and every other check stays exactly as strict: the run must still be that one manifest-named run, an allowed tag-push preparation of the exact commit, and it must have stopped, so a run that is still active or that never succeeded on any attempt is refused. Each earlier attempt consulted must itself describe that same run and commit; a missing, unreadable, or inconsistent attempt record fails closed. Asset bytes, names, manifest, and checksums are verified independently and are not relaxed by this. It never rebuilds or replaces bytes. Prereleases remain prereleases and do not replace the latest stable release; a stable release becomes latest.

Publication additionally refuses while any `release-prepare.yml` run for the exact tag has not reached a terminal status. It checks twice: once before downloading anything, so a live preparation rerun costs nothing, and again immediately before the single write that publishes the draft. A refusal names each non-terminal run and its status, fails the run, and consumes nothing — the authorization stands and the dispatch may be repeated once the preparation run is terminal.

Before authorizing publication, manually review the committed notes, prepare run, target evidence, exact draft downloads, unsigned warnings, and every readiness gate. After publication, download the public assets, recheck SHA-256, extract/verify, and run the bounded package smoke on each claimed host. Use the hosted verification below rather than an ad-hoc operator host.

## Post-publication verification

`.github/workflows/release-verify-published.yml` discharges the post-publication obligation above on real native hosts. It is manually dispatched, rejects every ref and workflow source except protected `master`, and requires an exact tag, the exact GitHub Release ID, and a typed `verify <tag> <release_id>` confirmation, so it cannot verify a release the operator did not name twice. Dispatch it only after the release is published:

```text
gh workflow run release-verify-published.yml --ref master \
  -f tag=v<version> -f release_id=<id> -f confirmation="verify v<version> <id>"
```

Do not dispatch it from an implementing pull request; the workflow must already be on protected `master`.

Its two jobs run on the claimed public target hosts, `ubuntu-latest` for Linux x64 and `windows-latest` for Windows x64. Each one revalidates the tag's committed identity, requires exactly one published, non-draft release for that exact tag whose ID matches the selector, and downloads the four public assets anonymously from their canonical `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>` URLs, so it proves what the public actually receives. It then verifies asset names, sizes, SHA-256 digests, and the manifest with `release:verify-assets`; validates each archive's own structure before opening it; extracts into a fresh directory that it refuses to reuse; and verifies, runs the repository-owned bounded package smoke, and verifies again. Every mismatch fails the run.

It publishes nothing and mutates nothing. `GITHUB_TOKEN` stays read-only and is used only to read the release list, no job enters an environment or reads a secret, and no step creates, updates, deletes, tags, signs, or uploads a release or asset. Each target retains only its compact JSON verification records for seven days; the downloaded assets and extracted packages stay runner-local and expire with the job.

The bounded smoke asserts a matching host, so a target is verified only by its own job. Package verification compares the packaged tracked text assets against the checkout's copies, and both are subject to the runner's line-ending configuration, so a Windows job is self-consistent with a Windows checkout and cannot by itself detect line-ending drift between hosts. Read the two job logs and JSON records; this evidence covers exactly the release ID it names and authorizes no support claim.

## Concurrent preparation and publication

GitHub concurrency groups are repository-wide, but preparation and publication declare deliberately distinct per-tag groups, so GitHub never serializes one against the other. They are not merged into one group on purpose: a shared group queues rather than refuses, a publication awaiting environment approval can hold its slot for up to 30 days, and the `release-target-*` artifacts a preparation rerun depends on expire after 14 — so a queued rerun would starve past artifact expiry and fail, which is precisely the same-run recovery contract this project exists to protect. A queued run can also be cancelled and replaced when a newer run joins its group. Refusal keeps both properties: nothing is ever queued, so an authorized publication can never be silently cancelled or superseded.

**This narrows the race; it does not close it.** Each side reads the other's workflow runs and then acts, so an interleaving remains possible in the interval between a check and the write that follows it, plus whatever staleness GitHub's workflow-run list carries — GitHub documents no freshness guarantee for it. Publication's re-check sits immediately before its only write to keep that interval as small as possible, and the existing exact-asset-set verification, release-ID rebind, asset-inventory recheck, and refusal to modify a published release all still apply underneath. Do not read this as a mechanical guarantee that the two workflows cannot overlap.

The operator rule is unchanged and still load-bearing: wait for a preparation rerun attempt to reach a terminal conclusion before another operation on that tag. Where an unapproved publication run blocks a needed preparation rerun, cancel that publication run or wait for its approval; do not work around the refusal. The full operator contract is in [`docs/release-administration.md`](docs/release-administration.md).

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
- `npm run release:verify-published -- download --tag=<tag> --release-id=<id> --repository=<owner/name> --output=<assets> --records=<dir>`
- `npm run release:verify-published -- extract --tag=<tag> --commit=<sha> --target=<platform-arch> --dir=<assets> --output=<dir>`
- `npm run release:verify-published -- record --tag=<tag> --release-id=<id> --commit=<sha> --runner=<label> --artifact=<path> --records=<dir>`

`release:verify-published` reads a published release and writes only local files and compact records; it never creates, updates, deletes, or publishes anything. Its `extract` step needs an archive tool that reads that target's format, which is why each target is extracted on its own native host.

`release:github` is workflow plumbing for paginated exact-tag preflight, same-run byte-idempotent draft synchronization, and publish-only revalidation bound to one release ID. It must not be used to bypass captain authorization or protected environments.
