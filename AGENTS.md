# AGENTS.md

The canonical contribution standard for budget-app, for people and AI agents alike (SPEC §16.5).
`SPEC.md` is the requirements document. Cite its IDs (`FR-…`, `NFR-…`, `KR-…`) in commits, PRs
and tests.

## Non-negotiables

0. **The mission** (NFR-MISSION-001). The app exists to move people out of financial stress. No
   feature, partner or revenue stream may target, exploit or deepen it. When a commercial interest
   and the user's interest conflict, the user's wins. This overrides everything below.
1. **No real financial data in the repository, ever** (NFR-PRIV-002). Only code and synthetic
   data. Fixtures live under `fixtures/` and carry the `x-synthetic` marker. Account IDs start
   `SYN-`. `data/` and `private/` are git-ignored scratch space. The data-hygiene gate
   (`npm run hygiene`) runs in CI. Enable it locally as a pre-commit hook with
   `npm run hooks:install`.
2. **No silent network** (NFR-PRIV-003). No third-party scripts, analytics or runtime CDN loads.
   The only egress is a user-configured API, called with per-call consent (M8). An e2e test
   asserts this.
3. **GSSK is pinned and unmodified** (NFR-KER-001). Never edit `vendor/gssk/`. Upgrade with
   `npm run gssk:update -- <dist-commit>` in its own PR. Work around kernel gaps in the app and
   record them as kernel requests (SPEC §17).
4. **Every number has a provenance label** (NFR-HON-001), and **an LLM never produces a number**
   (NFR-HON-002).
5. **Deterministic**: every stochastic step takes an explicit seed (NFR-DET-001).
6. **Spec deviations are ADRs** in `docs/adr/`.

## Layout

| Path                         | What                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                   | UI shell. `core/` holds the Boba-style `BaseComponent`, `Store` and `Router`. `components/<tag>/` holds one folder per custom element (`.html` + `.css` + `.ts`). |
| `src/lib/`                   | Shared primitives: SplitMix64 PRNG, money (bigint minor units), dates and time zones, hashing, JSON Schema subset, CSV, ZIP.                                      |
| `src/domain/`                | Canonical types (SPEC §5).                                                                                                                                        |
| `src/ingest/`                | CDR parsing and validation, the ledger (dedupe, pending→posted, transfers, reconciliation), the import service.                                                   |
| `src/synth/`                 | Persona validation, the seeded generator, the CLI.                                                                                                                |
| `src/budget/`                | Periods, tiers, budget lines, workbook CSV import, actual vs budget, CAPEX timing and sinking fund.                                                               |
| `src/forecast/`              | Monthly series, OPEX and CAPEX forecasts, evaluation; `ref/` holds the TypeScript reference kernels, `kernels.ts` switches to ml-core.                            |
| `ml-core/`                   | Rust crate → `ml-core.wasm` (raw exports, no dependencies). Every kernel has a TS twin and a parity test.                                                         |
| `src/classify/`              | Classification stages (rules, memory, MCC, model), the classifier service, the evaluation harness.                                                                |
| `src/data/`                  | The data service the `ingest` worker exposes: ledger plus classification.                                                                                         |
| `data-tables/`               | Shipped, editable tables: categories, MCC map, asset lifetimes.                                                                                                   |
| `src/store/`                 | IndexedDB wrapper with versioned migrations.                                                                                                                      |
| `fixtures/`                  | Personas and generated synthetic exports; `npm run fixtures` regenerates them.                                                                                    |
| `schemas/`                   | Persona schema; CDR schemas derived by `scripts/cdr-schemas.ts`.                                                                                                  |
| `src/sim/`                   | The freedom model: `modelgen`, the policy `controller`, tax, return samplers, Monte-Carlo and metrics. `gssk.ts` is the only code that touches WASM memory.       |
| `src/workers/`               | One entry per worker, exposed with the in-house RPC in `rpc.ts`. The UI never touches WASM directly.                                                              |
| `src/sw/sw.js`               | Service-worker template. The build fills in the precache list (`vite.config.ts`).                                                                                 |
| `vendor/gssk/`               | Pinned kernel and `GSSK_PIN.json`.                                                                                                                                |
| `tests/unit`, `tests/kernel` | Vitest (ADR 0006).                                                                                                                                                |
| `tests/e2e`                  | Playwright against the production build, including the privacy and offline tests.                                                                                 |
| `scripts/`                   | Data hygiene, bundle size, GSSK verify and update.                                                                                                                |
| `docs/`                      | VitePress site: guides, `adr/` (architecture decisions), the spec.                                                                                                |

## Conventions

- TypeScript strict, **erasable syntax only** (no `enum`, no parameter properties, no
  namespaces), explicit `.ts` import extensions. Source runs unchanged in Node and Vite.
- Components: markup in `.html`, styles in `.css` (`:host` is scoped to the tag), logic in `.ts`.
  Render dynamic data with DOM APIs and `textContent`, never by interpolating data into HTML
  strings.
- Money is integer minor units (`bigint`) with a currency code. Never binary floats for stored
  money (FR-ING-003).
- Keep logic that needs no DOM in plain modules, so it can be unit-tested without a DOM.
- Prettier formats everything. `tsc` (TypeScript 7) is the linter: strict, no unused locals or parameters, no implicit returns.
- **No third-party runtime dependencies** (ADR 0007). `dependencies` in `package.json` stays empty. Write it in-house, or propose an ADR.
- Scripts are TypeScript (`scripts/*.ts`), run directly by Node. No `.mjs`.

## Before every push

```bash
npm ci
npm run lint        # Prettier check
npm run typecheck
npm test            # unit and kernel tests (Vitest)
npm run hygiene
npm run build && npm run bundle-size
npm run mlcore:test # cargo test, clippy -D warnings, fmt --check
npm run e2e         # needs Playwright's Chromium: npx playwright install chromium
npm run docs:build  # VitePress fails on dead links
```

All must pass. CI runs the same on every PR.

## Workflow

Work on a feature branch, one milestone (SPEC §19) or smaller per PR, with green CI. The author
does not merge their own PR.
