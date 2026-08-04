# Release notes

Every proposed Electris release commits one Markdown file named exactly `v<package.json version>.md` in this directory. Examples are `v0.2.0-rc.1.md` and `v0.2.0.md`.

The note filename is part of the immutable version identity gate. Add it in the same pull request that runs `npm version --no-git-tag-version <version>`. Describe user-visible changes, exact public platforms/assets, unsigned or signed status, known limitations, support/security status, and migration or rollback considerations. Do not add notes for a tag until that version is genuinely proposed, and do not edit notes after its tag is created; corrections use a new version.

GitHub Release bodies use the committed file verbatim. Automatically generated notes are not a substitute because Electris does not require a commit-message convention.
