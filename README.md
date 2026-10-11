# budget-app

A local-first household budget and **freedom-capital** simulator that runs entirely in the
browser. It shows what you actually spend, forecasts what you will spend (including lumpy
capital purchases), and simulates whether your capital can fund a chosen standard of living, and
with what probability. Simulation runs on the [GSSK](https://github.com/energese-project/GSSK-Giannantoni)
stock-and-flow kernel, compiled to WebAssembly and pinned by hash.

- **Your data stays on your device.** No server, no account, no sync, no analytics.
- **Not financial advice.** The app simulates the consequences of your own assumptions and
  labels every number with where it came from.

See [SPEC.md](SPEC.md) for the full specification, [AGENTS.md](AGENTS.md) for how to contribute,
and the documentation site (`npm run docs:dev`, published at `/<repo>/docs/` on GitHub Pages).

## Status

| Milestone                 | State                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 Skeleton**           | Done: app shell, pinned GSSK kernel in a worker, offline, CI, GitHub Pages                                                                                                    |
| **M1 Synthetic + ingest** | Done: seeded synthetic households (three personas), CDR v1.36.0 import with validation, dedupe, pending→posted, transfer pairing, reconciliation, undo, IndexedDB persistence |
| M2–M8                     | Planned, one PR each (SPEC §19)                                                                                                                                               |

Try it: **Start → Try synthetic data → Generate and load**, then see the **Import** screen. Or import
a folder from `fixtures/syn-*-42/`.

## Develop

Requires Node ≥ 22.18 and Rust via rustup (the pinned toolchain in `rust-toolchain.toml` installs itself; `ml-core` builds to WebAssembly).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit and kernel tests (Vitest)
npm run e2e          # Playwright, against the production build
npm run build        # static site in dist/ (set BASE_PATH=/sub/path/ to host under a path)
npm run docs:dev     # documentation site (VitePress)
npm run synth -- --persona fixtures/personas/default.json --seed 7 --out /tmp/syn-7
npm run fixtures     # regenerate the committed fixtures after a generator change
npm run hooks:install  # data-hygiene pre-commit hook
```

## Decisions

| ADR                                                    | Decision                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [0001](docs/adr/0001-ui-framework.md)                  | Native web components (Boba pattern), no UI framework                                       |
| [0002](docs/adr/0002-test-runner.md)                   | `node:test` for unit tests (superseded by 0006)                                             |
| [0003](docs/adr/0003-csv-instead-of-xlsx.md)           | Budget workbooks imported as CSV, not xlsx                                                  |
| [0004](docs/adr/0004-gssk-pin-from-dist-branch.md)     | GSSK vendored from its `dist` branch, pinned by commit and SHA-256                          |
| [0005](docs/adr/0005-conservation-check.md)            | What GSSK's conservation error measures; how FR-SIM-003 is checked                          |
| [0006](docs/adr/0006-vitest-vitepress-pages.md)        | Vitest for tests, VitePress for docs, GitHub Pages for deployment                           |
| [0007](docs/adr/0007-no-third-party-runtime.md)        | No third-party runtime code; TypeScript 7; no ESLint; no `.mjs`                             |
| [0008](docs/adr/0008-cdr-ingest-and-synthetic-data.md) | CDR v1.36.0 ingest, `x-as-at` balances, rebuild-on-undo, synthetic data rules               |
| [0009](docs/adr/0009-classification.md)                | Classification stages, merchant memory, CAPEX proposals, evaluation                         |
| [0010](docs/adr/0010-budget-and-capex.md)              | Workbook CSV import rules, actual vs budget, replacement timing, sinking fund               |
| [0011](docs/adr/0011-forecasting-and-ml-core.md)       | Forecast methods and choice, bootstrap quantiles, CAPEX Monte-Carlo, ml-core ABI and parity |

## License

MIT. No third-party code ships in the app (ADR 0007). `src/app/core/` adapts code from [Boba](https://github.com/sholtomaud/boba) (MIT). GSSK is
MIT and bundles cJSON (MIT).
