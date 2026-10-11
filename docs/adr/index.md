# Decisions

Architecture decision records. Each one records a decision, its context and its consequences.
Every deviation from the [specification](../spec.md) gets one.

| ADR                                         | Decision                                                           | Status             |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| [0001](./0001-ui-framework.md)              | Native web components (Boba pattern), no UI framework              | Accepted           |
| [0002](./0002-test-runner.md)               | `node:test` for unit tests                                         | Superseded by 0006 |
| [0003](./0003-csv-instead-of-xlsx.md)       | Budget workbooks imported as CSV, not xlsx                         | Accepted           |
| [0004](./0004-gssk-pin-from-dist-branch.md) | GSSK vendored from its `dist` branch, pinned by commit and SHA-256 | Accepted           |
| [0005](./0005-conservation-check.md)        | What GSSK's conservation error measures; sinks accumulate          | Accepted           |
| [0006](./0006-vitest-vitepress-pages.md)    | Vitest for tests, VitePress for docs, GitHub Pages for deployment  | Accepted           |
