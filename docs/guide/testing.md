# Testing

| Layer      | Tool       | Where                                                                                                                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit       | Vitest     | `tests/unit/` — pure logic: routes, store, chart scales, data hygiene                                                                                                    |
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
