# Release administration rollout

These repository settings are approved policy but are **not** changed by the release-automation pull request. A repository administrator must apply and audit them under separate authorization before any candidate tag is created.

## Before a candidate tag

1. Set the default `GITHUB_TOKEN` permission to read-only and disable workflow permission to approve pull requests. The workflows declare narrower job-local writes where required.
2. Review every Action pin, then require Actions to be pinned by full commit SHA if that policy supports all approved actions. Existing and release workflows are committed with reviewed full-SHA pins.
3. Add a `v*` tag ruleset. Restrict creation to the designated release role and block update, force-update, and deletion. Keep documented administrators only as break-glass operators. The repository script still enforces strict SemVer and protected-`master` ancestry because a glob ruleset is not an identity validator.
4. Create `release-publish` with required reviewers, deployment-tag restrictions for `v*`, and no self-approval where GitHub supports it. The captain authorizes publication separately from tag preparation.
5. Reserve `release-signing` for later signing jobs. Put signing/notarization credentials only in that environment, with required reviewers and tag restrictions. Do not add those secrets at repository scope.
6. Enable GitHub private vulnerability reporting before claiming a supported release. Update `SECURITY.md` only after the route is verified from the public repository experience.
7. Confirm Linux x64, Windows x64, macOS arm64 (`macos-15`), and macOS x64 (`macos-15-intel`) runner availability and exact `process.platform`/`process.arch`. The workflow fails if a runner label supplies a different architecture. A captain may dispatch `.github/workflows/runner-qualification.yml` from protected `master` to produce this confirmation as evidence; see "Pre-tag runner qualification" in `RELEASING.md`.

Fork, pull-request, comment, and branch workflows must remain unable to enter either environment or receive its secrets. Do not add `pull_request_target` to any release path. Decode credentials only to restricted ephemeral files/keychains; never log, cache, or upload them.

## Canary and recovery proof

Under separate preparation authorization, use a new prerelease tag—never an archival tag—to prove:

- malformed/mismatched identity stops before packaging;
- one target failure prevents draft assembly;
- every target executes the bounded package smoke on a matching host;
- duplicate preparation accepts identical existing assets;
- partial upload adds only missing assets and a byte mismatch stops;
- draft downloads pass the manifest, checksum, extraction, package verification, and matching-host smoke checks; and
- publication waits for `release-publish` approval and performs no rebuild.

Inspect workflow event filters, permissions, environment deployment history, and logs. Workflow artifacts are qualification evidence, not public assets. Keep the canary draft until separately authorized publication or documented retirement.

## After recovery is proven

Enable immutable GitHub releases only after the captain accepts canary recovery behavior. Published bytes remain non-replaceable by policy even before the setting is enabled; corrections always use a new SemVer/tag. Record any break-glass operation and retain the affected tag, release, hashes, and workflow evidence.

Separately evaluate secret scanning, push protection, and Dependabot security updates. Those controls are valuable but do not substitute for the release identity, environment, and tag protections above.
