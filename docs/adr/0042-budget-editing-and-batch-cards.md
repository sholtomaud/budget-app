# ADR 0042 — Editing the budget in place; several changes on one card

- Status: accepted
- Date: 2026-10-15
- SPEC: §9.2 FR-BUD-003 (new), §12.1, FR-VIZ-004
- Builds on: ADR 0023 (the chat panel, cards), ADR 0028 (charts in the chat), ADR 0038 (the budget
  review)

## Context

A budget is not set and forget: people add, change and drop items every month. The Budget screen
showed categories only, and changing a line meant re-importing a sheet or deleting and re-adding it
in a collapsed table. In the chat, the AI could offer several changes in one answer, but each came
on its own card with its own Apply, so taking all of them was a chore and undoing them a bigger one.
And "a chart of spending, income and savings over time" was matched by the built-in savings rule and
answered with the plan's savings fan, which is not what was asked.

## Decision

1. **Categories open to their lines.** Each row of the actual-vs-budget table has a toggle that shows
   the category's budget lines as sub-rows. Every line's item, amount, period, share at the tier
   shown and category are cells that save on change. Enter saves and moves to the same cell of the
   next line; Escape puts the value back. Each open category ends with an Add item row. Delete
   offers Undo. The rules for a cell's text live in `src/budget/edit.ts` (pure, unit-tested): a bad
   value is refused with a reason and nothing is saved.
2. **Re-importing a sheet still replaces its lines.** Edits to an imported line keep its source, so
   a re-import of that sheet overwrites them; the item's tooltip says which sheet it came from.
3. **Several changes, one card.** When an answer brings more than one change (budget lines,
   categories, Big purchases, dashboards, budget changes, schedules), they come on one card. Each
   keeps its editable fields and gains a tick box; **Select all** ticks or clears them all. **Apply
   selected** applies the ticked ones in order, all or nothing: if one fails, those already applied
   are undone. **Undo all** reverses the batch. Plan changes (`setup`) stay one card each, because
   each is a whole plan and they are alternatives. The advisor's prompt says to call the propose
   tools once each so related changes arrive together.
4. **Spending, income and savings on one chart.** A new chart dataset, `saved` (income minus
   day-to-day spending each period, actual), lets the three share one time axis. The built-in
   matcher sends a request naming two or more of spending, income and savings to that chart before
   the plan's savings rule.

## Consequences

- The Budget screen is where the budget is kept, not just read. The separate Budget lines table
  remains as a flat list of every line.
- A batch is still never applied without the person, and its Undo all is one click (ADR 0023).
