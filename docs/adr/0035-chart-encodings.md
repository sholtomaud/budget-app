# ADR 0035 — Chart encodings: split by category, colour by meaning, shades; our own grammar

- Status: accepted
- Date: 2026-10-15
- SPEC: §6.9, FR-VIZ-001…003, FR-VIZ-007 (new), NFR-PRIV-003, NFR-HON-001
- Builds on: ADR 0007 (no third-party runtime dependencies), ADR 0028 (charts in the chat)

## Context

A person asked the AI for "a time-series chart by category, the budget against the actual in one
colour shade per category, the categories in different colours". The AI said it couldn't: a chart
spec (ADR 0028) was a list of series, each one colour picked by its position, with no way to break
a series down by category. It drew one spending line and one budget line instead.

The limit was the spec's vocabulary, not the renderer. Two directions were weighed:

1. **Adopt an external chart language and renderer.** TradingView's Charting Library is
   proprietary, licensed per site and made for market data (candles, studies); its Pine Script is
   a programming language, and the app does not run code an AI wrote (FR-VIZ-002). TradingView's
   open-source Lightweight Charts draws price and time series only: no categorical bars, tables or
   fans. Grafana's panel JSON is tied to Grafana's server and its data sources. Vega-Lite is the
   closest fit (a declarative grammar of graphics that models know well), but it lets a spec carry
   inline values, fetch URLs and evaluate expressions, and the runtime would roughly double the
   app's JavaScript. All of them break ADR 0007, and the first three don't fit the data.
2. **Grow our own spec toward a grammar of graphics**, in the same terms (split, colour, shade),
   keeping what ADR 0028 guarantees: a spec names datasets, never values; the app runs the queries
   on the device; nothing in a spec is code.

## Decision

The second. A series gains three optional fields, in the JSON Schema, the AI's strict tool input
and the dataset catalogue the AI reads:

- **`splitBy`: `category` | `group`.** On a time axis, the series becomes one series per category
  (or group): the biggest few by total, the rest folded into "Everything else" (8 for one split
  series, 6 when several are split). Split series in one chart share the same categories, so a
  budget split by category pairs with spending split by category. At most three series split.
  Not for savings over time (the whole plan) or a category axis (that is already by category).
- **`hue`: a name.** Series with the same hue share a colour; without one, each series has its
  own. A split series' hue is its category, so Food · Spent and Food · Budget are one colour.
- **`look`: `solid` | `light` | `dashed`.** The same colour, drawn lighter (45 % opacity) or
  dashed: "the plan for" its solid partner. In bars, light and dashed are a lighter fill (dashed
  with a dashed outline). The legend's swatch shows the look.

Colours stay the app's: the AI names a hue, never a colour value, and colours come from the theme's
eight-colour palette (readable in both themes, distinguishable with common colour blindness),
assigned per chart in order of first appearance. Each category's split series sit side by side in
the legend.

Two fixes ride along. Time axes keep labels level, about six of them, instead of slanting every
month. And a spending series that totals below zero gets a note: refunds and money in outweigh
money out, which is usually an import with its signs flipped.

## Consequences

- The request above is one spec: spending and budget, both split by category, the budget `light`.
  The AI is told how in the catalogue note.
- **Still our renderer, still no dependencies.** The spec's vocabulary now follows the grammar of
  graphics (series, grouping, colour, shade), so a later move to more marks (area, scatter, small
  multiples) adds fields rather than a new language. Dashboards (named layouts of charts) are the
  next ADR.
- Colours are per chart, not fixed per category across the app: eight colours can't keep a dozen
  groups apart everywhere. Within a chart, a category's actual and budget always match.
- Strict tool inputs carry the three fields (as `null` when unused), so a provider in strict mode
  sends them; the app checks every answer against the schema as before.
- **Tests:** unit tests for splitting, the cap and "Everything else", pairing by category, hue by
  name, the checks and the sign note; an e2e test where the AI asks for budget against spending by
  category and the chart pairs each category's lines in one colour, the budget lighter.
