# AGENTS.md

The canonical contribution standard for budget-app, for people and AI agents alike (SPEC §16.5).
`SPEC.md` is the requirements document. Cite its IDs (`FR-…`, `NFR-…`, `KR-…`) in commits, PRs
and tests.

## Non-negotiables

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

| Path                                             | What                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                                       | UI shell. `core/` holds the Boba-style `BaseComponent`, `Store` and `Router`. `components/<tag>/` holds one folder per custom element (`.html` + `.css` + `.ts`). |
| `src/sim/`                                       | `gssk.ts` is the only code that touches WASM memory. `run.ts` steps a model.                                                                                      |
| `src/workers/`                                   | One entry per worker, exposed with Comlink. The UI never touches WASM directly.                                                                                   |
| `src/sw/sw.js`                                   | Service-worker template. The build fills in the precache list (`vite.config.ts`).                                                                                 |
| `vendor/gssk/`                                   | Pinned kernel and `GSSK_PIN.json`.                                                                                                                                |
| `tests/unit`, `tests/kernel`, `tests/components` | Vitest; component tests run in happy-dom (ADR 0006).                                                                                                              |
| `tests/e2e`                                      | Playwright against the production build, including the privacy and offline tests.                                                                                 |
| `scripts/`                                       | Data hygiene, bundle size, GSSK verify and update.                                                                                                                |
| `docs/`                                          | VitePress site: guides, `adr/` (architecture decisions), the spec.                                                                                                |

## Conventions

- TypeScript strict, **erasable syntax only** (no `enum`, no parameter properties, no
  namespaces), explicit `.ts` import extensions. Source runs unchanged in Node and Vite.
- Components: markup in `.html`, styles in `.css` (`:host` is scoped to the tag), logic in `.ts`.
  Render dynamic data with DOM APIs and `textContent`, never by interpolating data into HTML
  strings.
- Money is integer minor units (`bigint`) with a currency code. Never binary floats for stored
  money (FR-ING-003).
- Keep logic that needs no DOM in plain modules, so it can be unit-tested without a DOM.
- Prettier formats everything; ESLint must be clean.

## Before every push

```bash
npm ci
npm run lint
npm run typecheck
npm test            # unit, kernel and component tests (Vitest)
npm run hygiene
npm run build && npm run bundle-size
npm run e2e         # needs Playwright's Chromium: npx playwright install chromium
npm run docs:build  # VitePress fails on dead links
```

All must pass. CI runs the same on every PR.

## Workflow

Work on a feature branch, one milestone (SPEC §19) or smaller per PR, with green CI. The author
does not merge their own PR.
