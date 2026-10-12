# Decisions

Architecture decision records. Each one records a decision, its context and its consequences.
Every deviation from the [specification](../spec.md) gets one.

| ADR                                                        | Decision                                                                                       | Status              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| [0001](./0001-ui-framework.md)                             | Native web components (Boba pattern), no UI framework                                          | Accepted            |
| [0002](./0002-test-runner.md)                              | `node:test` for unit tests                                                                     | Superseded by 0006  |
| [0003](./0003-csv-instead-of-xlsx.md)                      | Budget workbooks imported as CSV, not xlsx                                                     | Accepted            |
| [0004](./0004-gssk-pin-from-dist-branch.md)                | GSSK vendored from its `dist` branch, pinned by commit and SHA-256                             | Accepted            |
| [0005](./0005-conservation-check.md)                       | What GSSK's conservation error measures; sinks accumulate                                      | Accepted            |
| [0006](./0006-vitest-vitepress-pages.md)                   | Vitest for tests, VitePress for docs, GitHub Pages for deployment                              | Accepted            |
| [0007](./0007-no-third-party-runtime.md)                   | No third-party runtime code; TypeScript 7; no ESLint; no `.mjs`                                | Accepted            |
| [0008](./0008-cdr-ingest-and-synthetic-data.md)            | CDR v1.36.0 ingest, `x-as-at` balances, rebuild-on-undo, synthetic data rules                  | Accepted            |
| [0009](./0009-classification.md)                           | Classification stages, merchant memory, CAPEX proposals, evaluation                            | Accepted            |
| [0010](./0010-budget-and-capex.md)                         | Workbook CSV import rules, actual vs budget, replacement timing, sinking fund                  | Accepted            |
| [0011](./0011-forecasting-and-ml-core.md)                  | Forecast methods and choice, bootstrap quantiles, CAPEX Monte-Carlo, ml-core ABI and parity    | Accepted            |
| [0012](./0012-freedom-simulation.md)                       | Closed GSSK model, monthly constant edges, controller, tax, Monte-Carlo pool, metrics          | Accepted            |
| [0013](./0013-scenarios-and-optimiser.md)                  | Optimiser levers and distance, grid and CMA-ES (ml-core) with common random numbers, Pareto    | Accepted            |
| [0019](./0019-encryption-export-delete.md)                 | Wrapped data key, sealed records, lock by reload, `.budgetapp` export, delete-all              | Accepted            |
| [0014](./0014-workbook-mapping-assistant.md)               | Budget CSVs of any layout: one mapping spec; rules, an in-browser learned mapper, optional LLM | Proposed            |
| [0015](./0015-bayesian-workflow.md)                        | Bayesian workflow: pooled structural time series, shared spending factor, return uncertainty   | Accepted (see 0022) |
| [0016](./0016-sync-and-user-owned-storage.md)              | Local-first sync to storage the user owns (Google Drive first), end-to-end encrypted           | Proposed            |
| [0017](./0017-receipts-companion-app.md)                   | iOS receipts companion app (separate repo); line items reconciled to bank transactions         | Proposed            |
| [0018](./0018-monetisation-and-agentic-layer.md)           | Monetisation without selling data: on-device offers, intent marketplace, mandated agents       | Proposed            |
| [0020](./0020-name-landing-and-guide.md)                   | The name Crux, a plain-language landing page, a getting-started guide, plain menu names        | Accepted            |
| [0021](./0021-apis-and-advisor.md)                         | Optional AI providers: session-only keys, one egress gate with consent and a log, the advisor  | Accepted            |
| [0023](./0023-chat-panel.md)                               | The chat panel: built-in answers first, AI second, changes as cards                            | Accepted            |
| [0022](./0022-bayesian-spending-and-return-uncertainty.md) | The Bayesian spending model as built, its checks, and return-parameter uncertainty             | Accepted            |
