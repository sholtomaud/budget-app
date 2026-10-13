# ADR 0028 — Charts in the chat: built-in and AI-specified, saved on the device

- Status: proposed (milestone M10)
- Date: 2026-10-13
- SPEC: §12 (screens), FR-VIZ-001…006, NFR-HON-001, NFR-HON-002, NFR-PRIV-003, ADR 0007
- Builds on: ADR 0023 (chat panel), ADR 0027 (chat-first setup)

## Context

The chat answers in words; the charts live on the screens. A chat-first setup (ADR 0027) needs
charts in the conversation, with commentary. People will also ask for charts no screen has ("my
grocery spending by month against the budget, last two years"), and want to keep the ones they
find useful.

Two rules shape the design:

- **An LLM never produces a number** (NFR-HON-002). An AI-designed chart must not carry figures
  the AI wrote.
- **No third-party runtime and no code from the AI** (ADR 0007, NFR-PRIV-003). The AI can't send
  JavaScript, HTML or SVG to run.

## Decision

### A chart is a spec, the app supplies the data

Every chart in the chat, built-in or AI-designed, is a **chart spec**
(`schemas/chart-spec.schema.json`). A spec says what to show, never the values:

- `kind`: line, fan (quantile bands), bar, stacked bar, or table;
- `series`: each one a **query** against a named dataset in the app's catalogue, from a fixed
  vocabulary: dataset, filter (category, group, account, date range), group by (month, quarter,
  year, category), measure (sum, mean, count, P10/P50/P90);
- titles, axis labels, units and a short caption.

The app validates the spec and runs each query on the device. It draws the chart with the
existing in-house SVG components (`line-chart`, `fan-chart`, and a new `bar-chart`). Every chart
carries provenance labels (NFR-HON-001).

### The dataset catalogue

The AI sees **names and descriptions only**: `transactions`, `budget-lines`, `actuals-vs-budget`,
`forecast-paths`, `capex-register`, `freedom-capital`, `scenario-metrics`, with their fields and
units. No values are sent to build a chart. An AI-designed chart costs one call (the request and the
catalogue) and sends no household figures.

### Commentary

Each chart comes with a short explanation. For built-in charts, it is templated from the computed
results (ADR 0023's phrases). For AI-designed charts, the app sends the computed summary (the
same redacted, bucketed summary as other AI calls) and the AI writes the words. Any figure in the
words that isn't in that summary is flagged "unverified figure", as today.

### Saving charts

- **Save** on any chart in the chat keeps it under **Saved charts** in the menu.
- **What is saved:** the spec, its title and caption, and a snapshot of the computed values with
  the run reference, in the encrypted vault (ADR 0019). Delete-all and export include them.
- **Live or as it was:** a saved chart opens showing the snapshot, with a "Show with today's data"
  switch that re-runs its queries.
- **Download:** SVG, PNG (drawn on a canvas from the SVG) and CSV of the values.

## Consequences

- **Bespoke charts without new risk:** the AI can design any chart the vocabulary allows; it
  can't invent data or run code.
- **The vocabulary is the limit:** a chart the queries can't express is declined with a reason.
  The vocabulary grows by additions to the schema, each with a unit test; no ADR needed.
- **Tests:** spec validation (valid, invalid, hostile strings), query results against the
  ledger, snapshot round-trip through the vault, and an e2e test that saves and reopens a chart.
