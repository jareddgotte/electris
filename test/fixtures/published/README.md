# Published-artifact fixtures

These are verbatim bytes taken from a **published** Electris release asset. They exist so that
regression tests characterize a real defect with the bytes that exposed it rather than with a
synthetic reproduction. Never regenerate, reformat, or line-ending-normalize them.

`.gitattributes` marks this directory `-text` so the bytes reach the working tree unconverted on
every platform, including a Windows checkout with `core.autocrlf` enabled.

## Provenance

Both files were extracted from `resources/app.asar` inside
`electris-v0.2.0-rc.3-win32-x64-portable.zip`, downloaded anonymously from the
[`v0.2.0-rc.3`](https://github.com/jareddgotte/electris/releases/tag/v0.2.0-rc.3) release. The
archive's SHA-256 is `edfc806131e6368ffcca09fb7a5544b1e60919a6e15063b029fa85558a265f49`, matching the
digest recorded in that release's `electris-v0.2.0-rc.3-SHA256SUMS.txt`.

| Fixture | `app.asar` entry | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `v0.2.0-rc.3-win32-x64-css-main.css` | `css/main.css` | 2,366 | `c9e3fe3c619ed99149974db8af1c983c31a1d2e8bb7e4b01836530416b78f1c4` |
| `v0.2.0-rc.3-win32-x64-LICENSE` | `LICENSE` | 758 | `d15edc5cb3d9a163d6ebdbaa217de6d17b73353e350566eb4e15a5c0d3535703` |

Each differs from its checked-in source (`app/css/main.css` and `LICENSE`) by CRLF versus LF alone:
129 CRLF pairs for the stylesheet and 4 for the license, exactly their byte deltas. The tests assert
both digests and that equivalence, so a fixture that is ever altered fails immediately.
