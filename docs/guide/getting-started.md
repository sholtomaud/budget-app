# Getting started

## Requirements

- Node.js ≥ 22.18 (it runs the TypeScript scripts in `scripts/` directly)
- For end-to-end tests: Playwright's Chromium (`npx playwright install chromium`)

## Run it

```bash
npm install
npm run dev            # the app, at http://localhost:5173
npm run docs:dev       # these docs, at http://localhost:5174
```

## Scripts

| Script                                             | What it does                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`                                      | Vite dev server for the app                                                                |
| `npm run build`                                    | Production build of the app into `dist/`. Set `BASE_PATH=/sub/path/` to host under a path. |
| `npm run preview`                                  | Serve the production build                                                                 |
| `npm test`                                         | Unit and kernel tests (Vitest)                                                             |
| `npm run test:watch`                               | Vitest in watch mode                                                                       |
| `npm run e2e`                                      | Playwright end-to-end tests against the production build                                   |
| `npm run lint`                                     | Prettier check                                                                             |
| `npm run typecheck`                                | `tsc --noEmit` with TypeScript 7 (`tsgo`): types, unused code, implicit returns            |
| `npm run hygiene`                                  | Data-hygiene gate: rejects anything that looks like real financial data                    |
| `npm run bundle-size`                              | First-load JS budget (≤ 400 kB gzipped)                                                    |
| `npm run gssk:verify`                              | Check the vendored kernel against `GSSK_PIN.json`                                          |
| `npm run gssk:update -- <commit>`                  | Re-vendor GSSK from a `dist` branch commit                                                 |
| `npm run docs:dev` / `docs:build` / `docs:preview` | This documentation site (VitePress)                                                        |
| `npm run hooks:install`                            | Enable the data-hygiene pre-commit hook                                                    |

## Contributing

[`AGENTS.md`](https://github.com/sholtomaud/budget-app/blob/main/AGENTS.md) is the canonical
standard. In short: no real financial data in the repository, no silent network requests, never
modify the vendored kernel, label every number with its provenance, and record every spec deviation
as an [ADR](../adr/).
