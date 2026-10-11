# ADR 0002 — Unit tests on `node:test`, not Vitest

- Status: accepted
- Date: 2026-10-11
- Deviates from: SPEC §15.1 ("Vitest (unit, property via fast-check)")

## Decision

Unit and kernel tests use Node's built-in test runner on TypeScript source (`node --test`, native
type stripping, Node ≥ 22.18), following the Boba convention chosen in ADR 0001. Playwright stays
the e2e runner, as specified.

- `tests/unit/` holds pure logic. `tests/kernel/` holds the GSSK wrapper against the vendored wasm.
- Source files use erasable TypeScript only (`erasableSyntaxOnly`: no enums, no parameter
  properties) and import with explicit `.ts` extensions, so the same files run in Node and Vite.
- Property tests (from M1) use `fast-check`, which works under any runner.

## Consequences

One fewer dev dependency and no separate transform pipeline for tests. Tests cannot import modules
that use Vite-only features (`?raw`, `import.meta.glob`), so such modules stay thin and their logic
lives in plain modules.
