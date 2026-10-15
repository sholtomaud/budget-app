# ADR 0037 — The AI lays out dashboards: a whole layout, checked, saved on a card

- Status: accepted
- Date: 2026-10-15
- SPEC: FR-VIZ-009 (new), §13.3, NFR-HON-002, NFR-PRIV-003
- Builds on: ADR 0021 (providers, strict tools), ADR 0023 (proposals as cards), ADR 0028 (charts in
  the chat), ADR 0036 (dashboards)

## Context

Dashboards (ADR 0036) are built by hand. People also want to say "I need a dashboard for my
monthly check-in" and have one laid out, then change it in words ("add my groceries chart", "make
the timeline wide"). The AI must not be able to save anything on its own, or put values on a
page.

## Decision

1. **Two tools.** `list_dashboards` returns the dashboards (id, name, open or not, and each chart:
   its title, its built-in or saved id or its spec, wide or not), the built-in charts and the
   saved charts, by id and title: no values. `propose_dashboard` takes the **whole layout**: a
   `dashboardId` (or null for a new one), a name, and the charts in order, each exactly one of a
   built-in id (an enum in the schema), a saved chart's id, or a chart spec as for `make_chart`,
   and whether it is wide. A whole layout, not edits: one shape for making and changing, and
   nothing is lost to a misplaced index.
2. **Checked on the device** (`src/viz/dashboard-ai.ts`): nulls dropped, category names resolved
   to ids (shared with `make_chart`), every reference checked (known built-in, existing saved
   chart, existing dashboard), at most 12 charts, then `checkDashboard` (the schema and every spec
   through `checkSpec`). A problem goes back to the AI in words ("Chart 3: …") so it can fix it.
3. **A card, as for every change** (ADR 0023): it says what will be made or changed and lists the
   charts by title; the name can be edited. **Save dashboard** stores it and opens it; **Undo**
   puts the list back as it was. An Open Dashboards button comes with it. The Dashboards screen,
   if open behind the chat, redraws at once.
4. The advisor is told to use them for "a dashboard" or several charts on one page to come back
   to, to prefer built-in and saved charts, and that the result is a card to save.

## Consequences

- The AI can design anything a chart spec can say and arrange it, without saving anything or
  seeing a value; what it sends is checked like a template file would be (ADR 0036).
- Changing a dashboard means resending the charts to keep; `list_dashboards` gives them in the form
  `propose_dashboard` takes.
- **Tests:** unit tests for the answer (all three kinds of chart, names to categories, keeping the
  id when changing, every mistake in words) and for what the AI is told; an e2e test where the AI
  lists, proposes, the person renames and saves, the screen shows it, and Undo removes it.
