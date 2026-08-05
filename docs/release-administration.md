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

The temporary hooks are hard-coded for only `v0.2.0-rc.1`. They read two
repository variables, which are not credentials or secrets:

| Variable | Sole active value | Effect |
| --- | --- | --- |
| `ELECTRIS_CANARY_FAIL_TARGET` | `v0.2.0-rc.1:linux-x64` | Fails only the `linux-x64` package job before packaging. |
| `ELECTRIS_CANARY_STOP_AFTER_UPLOAD` | `v0.2.0-rc.1:after-one-upload` | Fails draft synchronization immediately after its first successful missing expected-asset upload. |

Absent, malformed, or other values, tags, and targets are inert. Changing the tag,
target, or behavior requires a reviewed code change; these variables cannot select a
new one. Neither hook is read by the publication workflow.

The following is the exact variable lifecycle for a separately authorized canary.
It is an operator plan only; it does not indicate that a tag, workflow run, draft, or
release exists. Run each GitHub CLI block from an authenticated administrator shell,
and do not overlap prepare runs for the tag.

First define a fail-closed absence check and verify that both variables are absent:

```bash
set -euo pipefail
repo=jareddgotte/electris
fail_variable=ELECTRIS_CANARY_FAIL_TARGET
upload_variable=ELECTRIS_CANARY_STOP_AFTER_UPLOAD

verify_canary_variables_absent() {
  variable_names="$(gh variable list --repo "$repo" --json name --jq '.[].name')"
  for name in "$fail_variable" "$upload_variable"; do
    if grep -Fxq "$name" <<<"$variable_names"; then
      echo "temporary canary variable is still present: $name" >&2
      return 1
    fi
  done
}

verify_canary_variables_absent
```

For the separately authorized exact-tag push, set and read back only the target
failure value:

```bash
gh variable set "$fail_variable" --repo "$repo" --body 'v0.2.0-rc.1:linux-x64'
test "$(gh variable get "$fail_variable" --repo "$repo")" = 'v0.2.0-rc.1:linux-x64'
```

After the prepare run fails (or after any unexpected interruption), remove the
variable immediately and verify both names absent before any recovery dispatch:

```bash
gh variable delete "$fail_variable" --repo "$repo"
verify_canary_variables_absent
```

Only after reviewing that failure may a separately authorized recovery dispatch use
the bounded partial-draft hook:

```bash
gh variable set "$upload_variable" --repo "$repo" --body 'v0.2.0-rc.1:after-one-upload'
test "$(gh variable get "$upload_variable" --repo "$repo")" = 'v0.2.0-rc.1:after-one-upload'
```

After that prepare run stops (or after any unexpected interruption), remove the
variable immediately and verify both names absent before the idempotent recovery
retry:

```bash
gh variable delete "$upload_variable" --repo "$repo"
verify_canary_variables_absent
```

The tag push and both recovery dispatches remain separate, explicitly authorized
operations; the commands above do not authorize them. Never leave either variable in
place while waiting for review or authorization.

Retain the following recovery evidence without claiming more than the logs and API
state prove:

- repository-variable audit/readback and the successful post-removal absence checks;
- the exact tag, commit, run URL, and `linux-x64` intentional failure log, with all
  target job conclusions, the assembly job skipped, and no draft created by that run;
- every matching-host bounded-smoke and target artifact result from the later complete
  matrix run;
- the partial run's intentional stop log, showing exactly one successful expected
  asset upload and an unpublished draft containing that asset only;
- asset name, size, downloaded SHA-256, and draft status before recovery;
- recovery logs showing the byte-identical asset accepted and only missing expected
  assets uploaded, followed by exact manifest/checksum verification; and
- an idempotent retry with no uploads, plus API/audit evidence that preparation made
  no publish, delete, replace, overwrite, or unexpected-asset mutation request.

A byte or size mismatch, duplicate, or extra asset is an investigation stop. Do not
remove, rename, or replace it to make recovery pass. Keep the draft unpublished and
escalate according to the incident guidance in [`../RELEASING.md`](../RELEASING.md).

Before approving the implementing workflow change or executing the plan, manually
compare the release workflows and record that event filters, top-level and job
permissions, protected environments, concurrency, full-SHA Action pins, secret flow,
native runner labels/matrix, bounded smoke commands, draft-only write path, and
publication's no-rebuild path are unchanged. Workflow artifacts are qualification
evidence, not public assets. Keep the canary draft until separately authorized
publication or documented retirement.

## After recovery is proven

Enable immutable GitHub releases only after the captain accepts canary recovery behavior. Published bytes remain non-replaceable by policy even before the setting is enabled; corrections always use a new SemVer/tag. Record any break-glass operation and retain the affected tag, release, hashes, and workflow evidence.

Separately evaluate secret scanning, push protection, and Dependabot security updates. Those controls are valuable but do not substitute for the release identity, environment, and tag protections above.
