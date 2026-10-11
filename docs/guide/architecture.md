# Architecture

budget-app is a static site with no backend. Everything runs in the browser.

```
UI (main thread, custom elements)
   │  typed postMessage RPC (src/workers/rpc.ts)
   ▼
Web Workers ── sim: gssk.wasm (pinned), model runner
               ingest · classify · forecast · optimise · synth   (later milestones)
   │
Storage: IndexedDB · OPFS          Service worker: offline after first load
```

## UI

Screens and widgets are native custom elements in the [Boba](https://github.com/sholtomaud/boba)
pattern ([ADR 0001](../adr/0001-ui-framework.md)). Each component is a folder under
`src/app/components/<tag>/` holding three files:

- `<tag>.html` — markup
- `<tag>.css` — styles; `:host` is rewritten to the tag name, so styles stay scoped
- `<tag>.ts` — a class extending `BaseComponent`

`src/app/core/` holds `BaseComponent`, an `EventTarget`-based `Store`, and a History-API `Router`
that lazy-loads `*-page` screens. Dynamic content is rendered with DOM APIs and `textContent`, so
imported text can never become markup.

## The simulation kernel

Money flows are simulated by [GSSK](https://github.com/energese-project/GSSK-Giannantoni), a C99
stock-and-flow kernel compiled to WebAssembly.

- `vendor/gssk/` holds the kernel and `GSSK_PIN.json`. The `sim` worker hashes `gssk.wasm` at load
  and refuses to run if it does not match the pin ([ADR 0004](../adr/0004-gssk-pin-from-dist-branch.md)).
- `src/sim/gssk.ts` is the only code that touches WASM memory: string marshalling, out-pointers,
  state views and freeing.
- Each rate change sets a mutation cause first, so every policy decision in a run is logged and
  can be replayed exactly.
- Sinks accumulate their inflow. GSSK's per-carrier "conservation error" reports net boundary flow
  for open models, so the money-balance check is done in the app
  ([ADR 0005](../adr/0005-conservation-check.md)).

## Privacy and offline

- The production build carries a Content-Security-Policy with `connect-src 'self'`. An e2e test
  asserts that no request leaves the app origin.
- A service worker, generated at build time, precaches every asset including `gssk.wasm`. The app
  works offline after the first visit.
- The repository holds synthetic data only, enforced by the data-hygiene gate in CI.
