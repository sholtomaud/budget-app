# ADR 0006 — Vitest for tests, VitePress for docs, GitHub Pages for deployment

- Status: accepted
- Date: 2026-10-11
- Supersedes: ADR 0002
- SPEC: §15.1 test stack restored to Vitest; §16.4 CI; §16.6 deployment

## Decision

- **Vitest** runs unit, kernel and component tests (`npm test`). It shares `vite.config.ts` with the
  app, so modules that use Vite features (`?raw`, `import.meta.glob`) can be tested directly.
  Component tests run in **happy-dom**. Assertions use Vitest's `expect`. Playwright stays the e2e
  runner.
- **VitePress** builds the documentation site from `docs/`: guides, the ADRs, and `SPEC.md`
  included verbatim. VitePress 1.6.4 bundles vite 5, which has dev-server advisories, so
  `package.json` overrides its vite to a patched 6.4.x.
- **GitHub Pages** hosts the app at `/<repo>/` and the docs at `/<repo>/docs/`. One workflow runs
  `build`, `test` and `e2e` on every PR and push. `deploy` publishes only from `main`, and only
  when all three pass.

## Consequences

- `node:test` is no longer used. Source still uses erasable TypeScript with `.ts` imports
  (ADR 0001), which Vitest handles natively.
- Pages must be switched to the "GitHub Actions" source once, in repository settings.
