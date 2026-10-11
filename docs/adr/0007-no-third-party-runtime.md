# ADR 0007 — No third-party runtime code; TypeScript 7; no ESLint, no `.mjs`

- Status: accepted
- Date: 2026-10-11
- SPEC: NFR-SEC-001 tightened; §15.1 stack amended

## Decision

1. **No third-party runtime dependencies.** The shipped app contains only this repository's code
   and the pinned GSSK kernel. `dependencies` in `package.json` stays empty. npm packages are
   build and test tooling only: Vite, Vitest, VitePress, Playwright, Prettier and TypeScript.
   - Comlink is replaced by `src/workers/rpc.ts`, a typed `postMessage` RPC of about 100 lines,
     unit-tested over a `MessageChannel`.
   - The spec's planned runtime libraries are replaced in-house: validators instead of Ajv, a
     thin IndexedDB wrapper instead of `idb`, and SVG charts only, no uPlot.
   - Optional ONNX Runtime Web or WebLLM (§15.1) would be the only exceptions. Each needs its own
     ADR, and would load only after the user opts in.
2. **No simulated DOM in tests.** happy-dom is removed. Custom elements are tested in a real
   browser by Playwright. Property tests use in-house seeded generators on SplitMix64, not
   fast-check.
3. **TypeScript 7** (`typescript@7`, the native `tsgo` compiler) typechecks everything.
4. **ESLint is removed.** typescript-eslint supports TypeScript only up to 6.0, so it cannot run on 7. `tsc` takes the linting role with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`,
   `noUnusedParameters`, `noImplicitReturns` and `allowUnreachableCode: false`. Prettier
   formats.
5. **No `.mjs`.** Scripts are TypeScript in `scripts/*.ts`, run directly by Node (≥ 22.18 strips
   types natively), and typechecked with the rest of the code.

## Consequences

The runtime bundle is smaller (15 kB of JS gzipped at M0) and has no third-party supply-chain
surface. We own more code: RPC, validation and storage wrappers. Each is small and tested.
