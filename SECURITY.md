# Security

Electris has no current supported release and GitHub private vulnerability reporting is not yet enabled.

## Reporting

- Do not file sensitive vulnerabilities as public issues.
- The approved future private route is GitHub private vulnerability reporting for this repository.
- A repository administrator must separately enable and verify that route before any supported-release claim. Until then, the missing private route remains an explicit release blocker rather than an invented contact method.

## Release security status

- Historical releases are unsupported archival artifacts.
- Strict tag/version identity, native bounded smoke evidence, archives, manifests, checksums, and draft-only publication controls are described in [`RELEASING.md`](RELEASING.md). They do not by themselves authorize or support a release.
- Initial Linux and Windows portable assets may be unsigned only with truthful trust warnings. Checksums are not signatures or provenance.
- Unsigned macOS output is qualification-only and withheld from public assets. Public macOS distribution requires approved Developer ID signing, notarization, stapling, Gatekeeper verification, and final matching-host smoke.
- The rc.1 documentation now records landed dependency remediation, runner-qualification workflow evidence, exact-tag canary/recovery hooks, and the approved release-administration controls; none of those facts create a supported release on their own.
- Focused icon/branding/trademark review remains required before public release.

## Related guidance

- [`RELEASING.md`](RELEASING.md)
- [`SUPPORT.md`](SUPPORT.md)
- [`docs/release-administration.md`](docs/release-administration.md)
- [`README.md`](README.md)
