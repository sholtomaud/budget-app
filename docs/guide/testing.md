# Testing

| Layer      | Tool       | Where                                                                                                                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit       | Vitest     | `tests/unit/` — pure logic: routes, store, chart scales, data hygiene                                                                                                    |
| Property   | Vitest     | `tests/property/` — invariants over many seeded random cases: import order and page overlap never change the ledger; synthetic balances always reconcile                 |
| Kernel     | Vitest     | `tests/kernel/` — the GSSK wrapper against the vendored wasm: pin check, init, step, reset, `setEdgeK` with cause, mutation log, replay, conservation, sink accumulation |
| End to end | Playwright | `tests/e2e/` — the production build in Chromium: custom elements, router, kernel run in the worker, CSP, offline reload, no-egress privacy                               |

```bash
npm test             # all Vitest suites
npm run test:watch   # watch mode
npm run e2e          # Playwright (builds the app first)
```

Components are tested in a real browser by Playwright, not in a simulated DOM. Unit tests cover
the DOM-free logic, so keep logic out of components where you can.

Property tests (from M1) use in-house seeded generators on SplitMix64, so failures replay exactly
(ADR 0007). Golden tests pin outputs for a fixed persona and seed
(SPEC §16.1).

## The data-hygiene gate

`npm run hygiene` scans every tracked file. It fails on:

- a CDR `accountId` that does not start with `SYN-`
- a BSB-and-account-number pattern
- a formatted Australian TFN with a valid check digit
- any `.xlsx`, `.ofx`, `.qif` or `.budgetapp` file, or anything under `data/` or `private/`
- a fixture without its `x-synthetic` marker

Test files that need real-looking values assemble them at runtime, so they pass the gate they test.

## Synthetic fixtures and golden tests

`fixtures/syn-<persona>-42/` holds generated CDR exports for each committed persona. A test
regenerates them and compares byte for byte, and another pins the generator's output hashes in a
snapshot. After a deliberate generator change, run `npm run fixtures` and `npx vitest run -u`, and
commit both. Tests check the importer against `truth.json`: pending→posted matches, transfer
pairing precision and recall, and that every transaction has a label.

## ml-core parity

Every kernel in the Rust crate has a TypeScript twin in `src/forecast/`. `tests/unit/mlcore-parity.test.ts`
loads the built `ml-core.wasm` and checks them against each other within 1e-9 relative, on random
inputs from the seeded property runner. SplitMix64 floats must be bit-identical. `npm run mlcore:test`
runs the crate's own tests, clippy with warnings as errors, and rustfmt.
