# Contributing to Electris

Thank you for contributing. Read [`AGENTS.md`](AGENTS.md) before changing the
repository; it is the authoritative source for the architecture, invariants,
generated files, supported toolchain, canonical commands, and validation expectations.

## Make a focused change

- Keep each pull request limited to one rationale or issue.
- Follow the process and gameplay boundaries documented in `AGENTS.md`.
- Include behavioral tests when behavior changes, and correct affected stale
  documentation in the same pull request.
- Do not commit generated application or package output.

## Pull-request conventions

Use a concise, imperative title that names the outcome, for example,
`Document contributor and PR conventions`. A scope is welcome when it adds clarity,
but Conventional Commits and a particular commit-message format are not required.

Complete the repository pull-request template. In the description:

- link the motivating issue or rationale, using a closing keyword such as `Closes #3`
  when the PR fully resolves an issue;
- summarize only the focused changes in the PR;
- state behavior and security impact explicitly, including `None` when applicable;
- list the exact automated and manual validation performed;
- identify documentation and dependency/lockfile changes;
- explain meaningful risks and a practical rollback; and
- include screenshots only when a visual change benefits from them.

Before requesting review, inspect the diff for unrelated edits and ensure the
validation expected by `AGENTS.md` passes. There is no additional heavyweight commit
policy; readable, reviewable commits are sufficient.
