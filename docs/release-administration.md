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

### Historical failed rc.1 evidence

The first exact-tag target-failure stage ran for `v0.2.0-rc.1` in
[Actions run 31017841566](https://github.com/jareddgotte/electris/actions/runs/31017841566).
Linux failed at the authorized canary hook, and Windows independently exposed unsafe
PowerShell path expansion in the tagged prepare workflow before package smoke or
archival. Both temporary variables were removed and their absence verified, assembly
was skipped, and no rc.1 draft, GitHub Release, or public asset set exists. The
immutable rc.1 tag remains failed, unpublished evidence and has no recovery dispatch;
[`../RELEASING.md`](../RELEASING.md) requires a corrected workflow in a new separately
authorized SemVer/tag.

Retain only the rc.1 evidence that the logs and API state prove:

- repository-variable audit/readback and the successful post-removal absence checks;
- the exact tag, commit, run URL, and `linux-x64` intentional failure log;
- the independent Windows pre-launch verification failure and skipped Windows archive;
- every target job conclusion, the skipped assembly job, and the absence of an rc.1
  draft, Release, or public asset set; and
- the immutable annotated rc.1 tag identity.

Do not set either old rc.1 canary value, dispatch preparation for rc.1, move, delete,
or reuse its tag. Its immutable workflow predates the recovery selector guard and
contains the Windows defect. A newer default-branch workflow would produce a prepare
head rejected by the preserved publication check. Do not claim a complete matrix,
partial-upload stop, draft recovery, idempotent retry, or publication proof for rc.1.

### Proposed rc.2 canary contract

The temporary hooks are now hard-coded for only `v0.2.0-rc.2`. They read two temporary
repository variables, which are selectors rather than credentials or secrets:

| Variable | Sole active value | Sole fail-only effect |
| --- | --- | --- |
| `ELECTRIS_CANARY_FAIL_TARGET` | `v0.2.0-rc.2:linux-x64` | Fails only the `linux-x64` package job before packaging. |
| `ELECTRIS_CANARY_STOP_AFTER_UPLOAD` | `v0.2.0-rc.2:after-one-upload` | Stops draft synchronization immediately after its first successful missing expected-asset upload. |

Absent, malformed, rc.1, other-tag, wrong-target, and near-match values are inert. The
variables cannot select another tag or target. The hooks cannot delete or replace an
asset, create a publication path, or publish a Release; neither variable is read by
the publication workflow. Changing the tag, target, or behavior requires another
reviewed code change. Retargeting is prerequisite code only and does not authorize a
tag, variable mutation, workflow run, draft, or publication.

Every separately authorized manual prepare for rc.2 recovery must select the same
existing tag as both the workflow ref and input:

```bash
tag=v0.2.0-rc.2
gh workflow run release-prepare.yml --repo jareddgotte/electris --ref "$tag" -f tag="$tag"
```

This runs the workflow version contained in the tag and preserves exact-head
publication. The guard rejects a branch ref or different tag; omitting `--ref` is not
a recovery. Never overlap prepare runs: confirm the preceding run has reached a
terminal conclusion before setting a variable or dispatching the next stage.

The following is the bounded future rc.2 procedure. Every tag, variable, workflow,
draft, and publication operation remains separately authorized. Before any operation,
confirm the protected native matrix is still Linux x64, Windows x64, macOS arm64 on
`macos-15`, and macOS x64 on `macos-15-intel`, and define a fail-closed absence check:

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

For the separately authorized exact-tag push, set and read back only the target-failure
value:

```bash
gh variable set "$fail_variable" --repo "$repo" --body 'v0.2.0-rc.2:linux-x64'
test "$(gh variable get "$fail_variable" --repo "$repo")" = 'v0.2.0-rc.2:linux-x64'
```

The separately authorized tag operation and its prepare run occur only after that
readback. After the run stops at the intended Linux hook, or after any unexpected
interruption, delete the variable immediately and verify both names absent:

```bash
gh variable delete "$fail_variable" --repo "$repo"
verify_canary_variables_absent
```

Record the exact tag, commit, run URL, intentional Linux failure, all other target
conclusions, skipped assembly, and absence of a draft or Release. Any failure other
than the selected Linux hook is an investigation stop.

Only after that run is terminal and both variables are proven absent may a separately
authorized partial-upload stage begin. Set and read back only the upload-stop value:

```bash
gh variable set "$upload_variable" --repo "$repo" --body 'v0.2.0-rc.2:after-one-upload'
test "$(gh variable get "$upload_variable" --repo "$repo")" = 'v0.2.0-rc.2:after-one-upload'
```

Then manually dispatch the exact existing tag using the command above. The four native
package jobs must succeed before assembly uploads exactly one missing expected asset
and stops. After that stop or any interruption, delete the variable immediately and
verify both names absent:

```bash
gh variable delete "$upload_variable" --repo "$repo"
verify_canary_variables_absent
```

Confirm the draft is still unpublished and contains exactly the one expected asset
with the expected bytes. A byte or size mismatch, duplicate, or extra asset is an
investigation stop. Do not remove, rename, or replace anything to make recovery pass.
Keep the draft unpublished and escalate according to the incident guidance in
[`../RELEASING.md`](../RELEASING.md).

After that run is terminal and variable absence is proven again, a separately
authorized exact-tag recovery dispatch with no canary variables may validate the
existing byte-identical asset and upload only the missing expected assets. Download
and verify the resulting exact draft set. One further separately authorized exact-tag
prepare with both variables absent must perform no uploads, replacements, or deletions;
that is the idempotent no-upload recovery proof. Any divergence stops the canary.
Publication remains a later protected-environment decision: it must consume this exact
successful prepare head and existing draft, download and revalidate every asset, and
publish without rebuilding or replacing bytes.

Before approving this retarget or executing any stage, manually compare the release
workflows and record that event filters, top-level and job permissions, protected
environments, concurrency, full-SHA Action pins, secret flow, native runner
labels/matrix, bounded smoke commands, public-asset policy, draft-only write path, and
publication's exact-head no-rebuild path are unchanged. The active default-branch
protection ruleset is unchanged. Workflow artifacts are qualification evidence, not
public assets. Keep the canary draft until separately authorized publication or
documented retirement.

## After recovery is proven

Enable immutable GitHub releases only after the captain accepts canary recovery behavior. Published bytes remain non-replaceable by policy even before the setting is enabled; corrections always use a new SemVer/tag. Record any break-glass operation and retain the affected tag, release, hashes, and workflow evidence.

Separately evaluate secret scanning, push protection, and Dependabot security updates. Those controls are valuable but do not substitute for the release identity, environment, and tag protections above.
