# Decisions

Architecture decision records. Each one records a decision, its context and its consequences.
Every deviation from the [specification](../spec.md) gets one.

| ADR                                             | Decision                                                                                    | Status             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------ |
| [0001](./0001-ui-framework.md)                  | Native web components (Boba pattern), no UI framework                                       | Accepted           |
| [0002](./0002-test-runner.md)                   | `node:test` for unit tests                                                                  | Superseded by 0006 |
| [0003](./0003-csv-instead-of-xlsx.md)           | Budget workbooks imported as CSV, not xlsx                                                  | Accepted           |
| [0004](./0004-gssk-pin-from-dist-branch.md)     | GSSK vendored from its `dist` branch, pinned by commit and SHA-256                          | Accepted           |
| [0005](./0005-conservation-check.md)            | What GSSK's conservation error measures; sinks accumulate                                   | Accepted           |
| [0006](./0006-vitest-vitepress-pages.md)        | Vitest for tests, VitePress for docs, GitHub Pages for deployment                           | Accepted           |
| [0007](./0007-no-third-party-runtime.md)        | No third-party runtime code; TypeScript 7; no ESLint; no `.mjs`                             | Accepted           |
| [0008](./0008-cdr-ingest-and-synthetic-data.md) | CDR v1.36.0 ingest, `x-as-at` balances, rebuild-on-undo, synthetic data rules               | Accepted           |
| [0009](./0009-classification.md)                | Classification stages, merchant memory, CAPEX proposals, evaluation                         | Accepted           |
| [0010](./0010-budget-and-capex.md)              | Workbook CSV import rules, actual vs budget, replacement timing, sinking fund               | Accepted           |
| [0011](./0011-forecasting-and-ml-core.md)       | Forecast methods and choice, bootstrap quantiles, CAPEX Monte-Carlo, ml-core ABI and parity | Accepted           |
| [0012](./0012-freedom-simulation.md)            | Closed GSSK model, monthly constant edges, controller, tax, Monte-Carlo pool, metrics       | Accepted           |
| [0013](./0013-scenarios-and-optimiser.md)       | Optimiser levers and distance, grid and CMA-ES (ml-core) with common random numbers, Pareto | Accepted           |
