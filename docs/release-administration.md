# Release administration rollout

These repository settings are approved policy but are **not** changed by the release-automation pull request. A repository administrator must apply and audit them under separate authorization before any candidate tag is created.

## Before a candidate tag

1. Set the default `GITHUB_TOKEN` permission to read-only and disable workflow permission to approve pull requests. The workflows declare narrower job-local writes where required.
2. Review every Action pin, then require Actions to be pinned by full commit SHA if that policy supports all approved actions. Existing and release workflows are committed with reviewed full-SHA pins.
3. Add a `v*` tag ruleset. Restrict creation to the designated release role and block update, force-update, and deletion. Keep documented administrators only as break-glass operators. The repository script still enforces strict SemVer and protected-`master` ancestry because a glob ruleset is not an identity validator.
4. Create `release-publish` with required reviewers, deployment-tag restrictions for `v*`, and no self-approval where GitHub supports it. The captain authorizes publication separately from tag preparation.
5. Reserve `release-signing` for later signing jobs. Put signing/notarization credentials only in that environment, with required reviewers and tag restrictions. Do not add those secrets at repository scope.
6. Enable GitHub private vulnerability reporting before claiming a supported release. Update `SECURITY.md` only after the route is verified from the public repository experience.
7. Confirm Linux x64, Windows x64, macOS arm64 (`macos-15`), and macOS x64 (`macos-15-intel`) runner availability and exact `process.platform`/`process.arch`. The workflow fails if a runner label supplies a different architecture. A captain may dispatch `.github/workflows/runner-qualification.yml` from protected `master` to produce this confirmation as evidence; see "Pre-tag runner qualification" in `RELEASING.md`. `.github/workflows/release-verify-published.yml` reuses the two public target runners after publication; it needs no setting, environment, or secret beyond the read-only default token, and see "Post-publication verification" in `RELEASING.md` for its operator flow.

Fork, pull-request, comment, and branch workflows must remain unable to enter either environment or receive its secrets. Do not add `pull_request_target` to any release path. Decode credentials only to restricted ephemeral files/keychains; never log, cache, or upload them.

## Canary and recovery evidence

<a id="canary-and-recovery-proof"></a>

This section was previously titled "Canary and recovery proof". The frozen
[`releases/v0.2.0-rc.2.md`](releases/v0.2.0-rc.2.md) snapshot is preserved incident
evidence and is never edited, so it still points here by that former title. Both that
name and the `#canary-and-recovery-proof` anchor resolve to this section.

### Historical failed rc.1 evidence

The first exact-tag target-failure stage ran for `v0.2.0-rc.1` in
[Actions run 31017841566](https://github.com/jareddgotte/electris/actions/runs/31017841566).
Linux failed at the authorized canary hook, and Windows independently exposed unsafe
PowerShell path expansion in the tagged prepare workflow before package smoke or
archival. Both temporary variables were removed and their absence verified, assembly
was skipped, and no rc.1 draft, GitHub Release, or public asset set exists. The
immutable rc.1 tag remains failed, unpublished evidence and has no recovery run;
[`../RELEASING.md`](../RELEASING.md) requires a corrected workflow in a new separately
authorized SemVer/tag.

Retain only the rc.1 evidence that the logs and API state prove:

- repository-variable audit/readback and the successful post-removal absence checks;
- the exact tag, commit, run URL, and `linux-x64` intentional failure log;
- the independent Windows pre-launch verification failure and skipped Windows archive;
- every target job conclusion, the skipped assembly job, and the absence of an rc.1
  draft, Release, or public asset set; and
- the immutable annotated rc.1 tag identity.

Do not set either old rc.1 canary value, dispatch or rerun preparation for rc.1, move,
delete, or reuse its tag. Do not claim a complete matrix, partial-upload stop, draft
recovery, idempotent retry, or publication proof for rc.1.

### Confirmed rc.2 duplicate-draft and byte-drift incident

The rc.2 procedure reached the partial-upload stage, but it disproved the former
fresh-dispatch recovery contract. Preserve the full public problem statement in
[issue 59](https://github.com/jareddgotte/electris/issues/59) and these run links:

- [initial rc.2 tag-push failure](https://github.com/jareddgotte/electris/actions/runs/31036913029);
- [partial one-asset preparation](https://github.com/jareddgotte/electris/actions/runs/31037458160); and
- [fresh-dispatch duplicate-draft result](https://github.com/jareddgotte/electris/actions/runs/31038280899).

The initiating trigger was the partial run, which left draft `365756727` with checksum
asset `502980359`. The masking defect was release discovery through the release-by-tag
endpoint: it returned 404 while the authenticated paginated release list and direct-ID
queries exposed the draft. Preflight and synchronization treated that 404 as absence,
so the fresh dispatch created draft `365762809`. The visible symptom is two unpublished
exact-tag drafts, with one and four assets respectively.

The two 332-byte checksum assets are not byte-identical:

- asset `502980359`: `sha256:c4a6a03b886c9465cf137e3bed7f4d103f3eb07677783a9f128fd09e199ae234`;
- asset `502989533`: `sha256:edbd93947f835d91e3f234a4de6ae187e9cd73f684dcd245a5a411e81619f045`.

Every digest inside the checksum files differs because the fresh run rebuilt archives
and embedded a new workflow run identity in fragments and the manifest. Correct draft
discovery would have rejected those bytes before upload; a fresh dispatch could not
have completed the partial set safely.

Both rc.2 canary variables are absent. Do not set them again. Do not dispatch or rerun
rc.2 preparation, dispatch publication, delete either draft, delete/replace/rename an
asset, publish either draft, or move/delete either rc tag. The immutable rc.2 workflow
cannot acquire a default-branch fix. Both drafts, all five assets, tags, and runs remain
incident evidence until a separately authorized disposition.

## Same-run recovery contract for a successor

The prepare workflow accepts tag-push events only. A future successor candidate must
contain this corrected workflow before its separately authorized immutable tag is
created. A new `workflow_dispatch`, repeated tag event, newer-branch run, or rebuilt
asset set is not recovery.

`v0.2.0-rc.3` is the currently proposed successor candidate, under
[issue 61](https://github.com/jareddgotte/electris/issues/61). The corrected workflow
is already on protected `master` through
[PR 60](https://github.com/jareddgotte/electris/pull/60), so a separately authorized
rc.3 tag would carry it. That proposal commits a version and note only: it creates no
tag, workflow run, draft, GitHub Release, or asset set, and it changes nothing about
the retained rc.1 and rc.2 evidence above.

GitHub rerun attempts retain the workflow run ID. Successful package jobs retain their
`release-target-*` artifacts for 14 days; rerunning failed jobs and their dependents in
the same run lets assembly download those exact archives and fragments. Because every
fragment records `github.run_id`, the manifest and checksum provenance remain stable.
Use the following only for a separately authorized successor run, never rc.1 or rc.2:

```bash
set -euo pipefail
repo=jareddgotte/electris
run_id=<authorized-successor-prepare-run-id>

gh run view "$run_id" --repo "$repo"
gh run rerun "$run_id" --repo "$repo" --failed
```

Wait for that rerun attempt to reach a terminal conclusion before another operation.
Do not use `gh workflow run release-prepare.yml`. If target artifacts have expired, a
required package artifact is absent, the run/tag/head does not match, or rerunning
failed jobs cannot reach assembly, stop. Correct the source if necessary and propose a
new SemVer/tag; do not rebuild under a fresh run and call it byte recovery.

### Concurrent preparation and publication for one tag

That wait is now also enforced in both directions, because the two workflows carry
distinct repository-wide concurrency groups and GitHub therefore never serializes them
against each other:

- draft assembly refuses, before it discovers or creates anything, while any
  `release-publish.yml` run for the exact tag is non-terminal, including one waiting for
  environment approval; and
- publication refuses while any `release-prepare.yml` run for the exact tag is
  non-terminal, checked once before it downloads any asset and again immediately before
  the write that publishes the draft.

Each refusal names every offending run and its status and writes nothing. Terminality is
tested as `status == "completed"`, so a status GitHub adds later cannot be mistaken for
a finished run. `assemble-draft` carries `actions: read` for its side of this; the
publication job already declared it. The concurrency groups are unchanged and both keep
`cancel-in-progress: false`.

Preparation identifies a publication run by that run's ref, which is the only field in
the workflow-run list naming the tag it targets. Dispatch a publication from the exact
tag being published: the workflow now fails before checkout unless the selector, the
dispatch ref, and the confirmation all name one tag. The environment's `v*`
deployment-tag policy is not a substitute, because it admits a dispatch from any release
tag while the selector names a different one, and preparation would then never see that
publication.

**This narrows the window; it does not close it.** Both sides read before either writes,
so an interleaving remains reachable in the interval between a check and the following
write, plus the undocumented staleness of GitHub's workflow-run list. Treat the refusal
as a loud backstop for an operator mistake, not as proof the two workflows cannot
overlap, and keep following the wait rule above. End-to-end behaviour under a real
concurrent run is unproven here and belongs to a separately authorized successor canary;
do not create a tag or dispatch a release workflow to test it.

When a preparation rerun is refused because an unapproved publication run for that tag is
still waiting, there are exactly two acceptable remedies, and both are visible acts:
cancel that publication run — nothing has been published and the authorization can be
re-issued — or wait for it to be approved and reach a terminal conclusion, then rerun.
Do not merge the two concurrency groups to make the wait implicit: an unapproved
publication holds its slot for up to 30 days while `release-target-*` artifacts expire
after 14, so queueing a rerun behind it would silently starve the same-run recovery
contract, and a queued run can additionally be cancelled and replaced when a newer run
joins its group.

A separately authorized partial-upload canary for a successor requires another focused
change that retargets the inert exact-value hooks. After the assembly job intentionally
stops, remove its temporary variable and prove all canary variables absent. Then use
`gh run rerun "$run_id" --repo "$repo" --failed` so only the failed assembly path is
retried against successful package artifacts from that run. Synchronization must:

1. refuse before any discovery or write while a `release-publish.yml` run for the exact
   tag is non-terminal;
2. search every authenticated release-list page for exact `tag_name` matches, acting
   only after two consecutive complete list snapshots agree on the same ordered,
   duplicate-free release IDs and refusing to act under sustained list churn;
3. require zero or one candidate before creation and exactly the created release ID
   afterward, retrying only a stale list that omits an ID this run already holds, on a
   bounded schedule that fails closed without uploading if the release never appears;
4. recheck exact-tag uniqueness and the bound ID before asset upload and before reporting success;
5. validate all existing asset names, sizes, and bytes before writing any missing file; and
6. stop without upload, replacement, deletion, or publication on ambiguity or byte drift.

After successful recovery, a separately authorized no-upload proof may rerun the
successful assembly job within the same workflow run:

```bash
assemble_job_id="$(
  gh run view "$run_id" --repo "$repo" --json jobs \
    --jq '[.jobs[] | select(.name == "Assemble guarded draft" and .conclusion == "success") | .databaseId] | last'
)"
test -n "$assemble_job_id" && test "$assemble_job_id" != null
gh run rerun "$run_id" --repo "$repo" --job "$assemble_job_id"
```

That attempt must perform no release upload, update, deletion, or publication. Download
and verify the exact four-asset draft after recovery and after the no-upload proof.
Publication remains a later protected-environment decision. It must refuse while any
`release-prepare.yml` run for the exact tag is non-terminal, rediscover exactly one
draft through authenticated pagination, bind to that release ID, verify the exact asset
set and one successful, allowed tag-push prepare run for the tagged commit, recheck
uniqueness, asset inventory, and preparation-run terminality, and publish without
rebuilding or replacing bytes.

Because every recovery and no-upload-proof step above adds an attempt to that same run,
a later attempt failing must not disqualify the draft an earlier attempt assembled.
Publication therefore accepts a successful conclusion on any attempt of the
manifest-named run once the run has stopped, and keeps the run identity, exact commit,
tag-push event, workflow path, asset set, manifest, and checksum checks unchanged. Only
the manifest's run is ever consulted, so this cannot admit assets from another run.

Before any successor operation, manually compare the release workflows and record the
event filters, top-level and job permissions, protected environments, concurrency,
full-SHA Action pins, token and secret flow, native runner labels/matrix, bounded smoke
commands, artifact retention, public-asset policy, draft-only write path, and
publication's exact-head no-rebuild path. Workflow artifacts are qualification
evidence, not public assets.

## After recovery is proven

Enable immutable GitHub releases only after the captain accepts a successor canary's
same-run recovery behavior. Published bytes remain non-replaceable by policy even
before the setting is enabled; corrections always use a new SemVer/tag. Record any
break-glass operation and retain the affected tag, release, hashes, and workflow
evidence.

Separately evaluate secret scanning, push protection, and Dependabot security updates.
Those controls are valuable but do not substitute for the release identity,
environment, and tag protections above.
