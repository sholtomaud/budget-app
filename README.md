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

**M0 — Skeleton** (SPEC §19):

- Vite app shell built from native web components (ADR 0001), with every SPEC §12 screen routed.
  Screens that later milestones fill show which milestone delivers them.
- GSSK 5.3.0 vendored in `vendor/gssk/`, with its SHA-256 checked in CI and again at load. The
  `sim` worker refuses a kernel that does not match the pin.
- The **Kernel** screen runs GSSK's reference household model in a Web Worker.
- Works offline after first load (service worker). A Content-Security-Policy limits connections
  to the app's own origin.
- CI: `build` (data-hygiene gate, pin check, lint, typecheck, app and docs builds, bundle-size
  budget), `test` (Vitest) and `e2e` (Playwright: shell, kernel, offline, no-egress privacy). Pushes
  to `main` deploy the app and docs to GitHub Pages once all three pass.

## Develop

Requires Node ≥ 22.18.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit, kernel and component tests (Vitest)
npm run e2e          # Playwright, against the production build
npm run build        # static site in dist/ (set BASE_PATH=/sub/path/ to host under a path)
npm run docs:dev     # documentation site (VitePress)
npm run hooks:install  # data-hygiene pre-commit hook
```

## Decisions

| ADR                                                | Decision                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| [0001](docs/adr/0001-ui-framework.md)              | Native web components (Boba pattern), no UI framework              |
| [0002](docs/adr/0002-test-runner.md)               | `node:test` for unit tests (superseded by 0006)                    |
| [0003](docs/adr/0003-csv-instead-of-xlsx.md)       | Budget workbooks imported as CSV, not xlsx                         |
| [0004](docs/adr/0004-gssk-pin-from-dist-branch.md) | GSSK vendored from its `dist` branch, pinned by commit and SHA-256 |
| [0005](docs/adr/0005-conservation-check.md)        | What GSSK's conservation error measures; how FR-SIM-003 is checked |
| [0006](docs/adr/0006-vitest-vitepress-pages.md)    | Vitest for tests, VitePress for docs, GitHub Pages for deployment  |

## License

MIT. `src/app/core/` adapts code from [Boba](https://github.com/sholtomaud/boba) (MIT). GSSK is
MIT and bundles cJSON (MIT).
