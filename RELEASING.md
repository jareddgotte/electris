# Release readiness

Electris does not have a current supported release. Historical 2018 ZIP assets remain archival only.

This checklist is manual. Do not publish anything until every step is complete and separately authorized.

## 0. Release authorization

- **Prepare authorization:** a designated release authorization owner approves creating or updating a draft release candidate.
- **Publish authorization:** that owner separately approves publishing the final release.
- If the owner is not designated, or either authorization is missing, stop here.

## 1. Baseline evidence

- Confirm the checked-out commit is approved for release.
- Confirm `package.json` version, changelog/release-note entry, and any release metadata agree.
- Confirm deterministic PR validation is green in `.github/workflows/pull-request.yml`.
- Keep deterministic PR checks distinct from any locally built artifact evidence.

## 2. Clean local validation

Run the repository-owned commands from the root:

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run smoke`
- `npm run docs:check`
- `npm run build`

These validate source, not a release artifact.

## 3. Package and verify

Use the landed packaging commands and the reviewed target allowlist in `scripts/package-config.cjs`:

- Host build/package: `npm run package:host`
- Reviewed target package: `npm run package:target -- --platform=<darwin|linux|win32> --arch=<reviewed-arch>`
- Artifact verification: `npm run package:verify -- dist/electris-v<version>-<platform>-<arch>`
- Matching-host smoke: `npm run package:smoke -- dist/electris-v<version>-<platform>-<arch>`

Safe evidence expectations:

- `package:verify` confirms artifact identity, runtime version, allowlisted payload, and forbidden-path absence.
- `package:smoke` records target-executed startup, isolated preload, CSP/navigation, window controls, and score restart evidence.
- It does **not** cover historical-score migration or corrupt-score fallback; those remain blocked until a future evidence path is added.
- Buildable-only or cross-built artifacts stay unverified until `package:smoke` runs on that exact target OS/architecture.

## 4. Package content review

Inspect the artifact for:

- exact Electris version and Electron version;
- expected executable platform/architecture;
- `LICENSE`, source-map, and production-dependency policy as implemented by the package verifier;
- no source, test, cache, secret-like, or other forbidden paths.

## 5. Release asset handling

- Generate a checksum file for each uploaded asset with a portable explicit command such as `sha256sum <artifact> > <artifact>.sha256` before publication.
- Draft release assets, uploaded archives, and checksums are separate evidence.
- Checksums help integrity checking only; they do not prove origin or provenance.
- Do not claim PR CI built an uploaded asset.
- Do not claim a checksum is a signature or provenance substitute.

## 6. Signing and notarization

- **Disposition:** unsupported/blocked until explicitly approved for a later release proposal.
- **Credential owner:** none recorded.
- Do not infer signing or notarization from packaging output.

## 7. Security and support blockers

- **Private vulnerability reporting route:** unsupported/blocked until a repository-approved private route exists.
- **Support window:** unsupported/blocked; no current supported release exists.
- **Supported platforms:** only platforms with recorded target-executed `package:smoke` evidence may be claimed.
- **Historical binaries:** unsupported, archival only.
- **Branding/trademark review:** blocked until a separate review records its outcome.

## 8. Publish authorization

Only after all applicable evidence exists may the designated release authorization owner separately authorize publication.

- Verify the draft release, upload list, and notes manually.
- Publish only after explicit publish authorization.
- Keep the draft evidence and checksum records.

## 9. Post-publication verification

After publication:

- download the published asset from the release page;
- verify the checksum against the uploaded checksum file;
- run startup validation on the published artifact on the claimed target host;
- confirm the release page, notes, and asset names match the approved draft.

## 10. Rollback and deprecation

If a release must be withdrawn or superseded:

- deprecate the release with a follow-up release note or release-page notice;
- publish a replacement only with new authorization;
- retain prior checksums, notes, and verification evidence;
- do not delete historical evidence just to hide a failed release.

## Authoritative references

- [`AGENTS.md`](AGENTS.md)
- [`README.md`](README.md)
- [`scripts/package-config.cjs`](scripts/package-config.cjs)
- [`scripts/package-verify.cjs`](scripts/package-verify.cjs)
- [`scripts/package-smoke.cjs`](scripts/package-smoke.cjs)
