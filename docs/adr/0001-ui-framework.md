# ADR 0001 — UI framework: native web components (Boba pattern)

- Status: accepted
- Date: 2026-10-11
- SPEC: amended to match in Draft 2
- Resolves: SPEC §20 open question 1; deviates from SPEC §15.1 ("Preact + signals (or Svelte)")

## Context

SPEC §15.1 asks for a small-bundle UI and leaves Preact vs Svelte to an M0 ADR. The project owner
chose a third option: native web components in the style of
[Boba](https://github.com/sholtomaud/boba) (docs: <https://sholtomaud.github.io/boba/docs>).

## Decision

- Screens and widgets are **custom elements**, one folder per component under
  `src/app/components/<tag>/`, each three files: `<tag>.html` (markup), `<tag>.css` (styles,
  `:host`-scoped) and `<tag>.ts` (logic). Markup and styles are imported with Vite's `?raw`.
- `src/app/core/` holds the Boba-derived pieces, adapted for strict TypeScript:
  `BaseComponent` (light DOM, `:host` rewritten to the tag name), `Store` (an `EventTarget` that
  emits `change`) and a History-API `Router` that lazy-loads `*-page` components.
- Dynamic content uses DOM APIs (`createElement`, `textContent`, `<template>` cloning). Never
  build HTML strings from data, so imported text can never become markup.
- **No Tailwind.** Boba's demo uses it, but design tokens as CSS custom properties in
  `src/styles/global.css` (light and dark themes, a colour-blind-safe series palette and
  provenance colours) cover what we need with no build-time CSS framework.
- Charts are hand-written SVG components (`line-chart`), as §15.1 allows.

## Consequences

- No runtime UI dependency, and no third-party runtime code at all (ADR 0007).
- Unit tests cover the DOM-free parts (`routes.ts`, `store.ts`, `chart-scale.ts`). Components are
  covered by Playwright.
- Boba targets Node ≥ 25. We need Node ≥ 22.18. Tests run on Vitest (ADR 0006).
