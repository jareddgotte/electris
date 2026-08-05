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

The first exact-tag target-failure stage ran for `v0.2.0-rc.1`. Linux failed at the
authorized canary hook, and Windows independently exposed unsafe PowerShell path
expansion in the tagged prepare workflow before package smoke or archival. Both
temporary variables were removed, assembly was skipped, and no rc.1 Release or public
asset set exists. The immutable rc.1 tag remains failed, unpublished canary evidence
and has no recovery dispatch; [`../RELEASING.md`](../RELEASING.md) requires a corrected
workflow in a new separately authorized SemVer/tag.

The temporary hooks are hard-coded for only `v0.2.0-rc.1`. They read two
repository variables, which are not credentials or secrets:

| Variable | Sole active value | Effect |
| --- | --- | --- |
| `ELECTRIS_CANARY_FAIL_TARGET` | `v0.2.0-rc.1:linux-x64` | Fails only the `linux-x64` package job before packaging. |
| `ELECTRIS_CANARY_STOP_AFTER_UPLOAD` | `v0.2.0-rc.1:after-one-upload` | Fails draft synchronization immediately after its first successful missing expected-asset upload. |

Absent, malformed, or other values, tags, and targets are inert. Changing the tag,
target, or behavior requires a reviewed code change; these variables cannot select a
new one. Neither hook is read by the publication workflow.

Every separately authorized manual prepare recovery for a future tag must select that
same existing tag as both the workflow ref and input:

```bash
tag=v<version>
gh workflow run release-prepare.yml --repo jareddgotte/electris --ref "$tag" -f tag="$tag"
```

This ensures the run uses the workflow version contained in the tag and preserves the
exact-head publication check. The guard rejects a branch ref or a different tag.
Omitting `--ref` is not a recovery because GitHub CLI selects the default-branch
workflow. Do not invoke `v0.2.0-rc.1`; its immutable workflow predates the guard and
contains the Windows defect.

The following blocks record the variable lifecycle that governed the authorized rc.1
target-failure stage. They are retained as audit procedure, not permission to repeat
the failed tag. Run no command below without separate authorization, and do not
overlap prepare runs for a tag.

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

The original plan next called for the bounded partial-draft hook and two recovery
dispatches. They were not run. Do not set either canary variable or dispatch
preparation for rc.1: its tagged workflow is defective, while a newer default-branch
workflow would produce a prepare head rejected by the preserved publication check.
Retargeting a canary requires a reviewed code change and separate operator
authorization for a new tag.

Retain only the rc.1 evidence that the logs and API state prove:

- repository-variable audit/readback and the successful post-removal absence checks;
- the exact tag, commit, run URL, and `linux-x64` intentional failure log;
- the independent Windows pre-launch verification failure and skipped Windows archive;
- every target job conclusion, the skipped assembly job, and the absence of an rc.1
  draft, Release, or public asset set; and
- the immutable annotated rc.1 tag identity.

Do not claim a complete matrix, partial-upload stop, draft recovery, idempotent retry,
or publication proof for rc.1. A future separately authorized canary must collect all
of that evidence before immutable releases can be enabled.

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
