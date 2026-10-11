# ADR 0010 — Budget, workbook CSV import and the CAPEX register (M3)

- Status: accepted
- Date: 2026-10-11
- SPEC: §6.2, §9 refined; amended to match in Draft 5

## Decisions

1. **Workbook import is a preview, then a commit** (FR-ING-010).
   - The sheet type is detected from the header row by preset signatures: OPEX budget, CAPEX
     register, wish list, renewals, goal.
   - Columns map by name aliases. The user can change the type, any column mapping, and how
     imported categories map to app categories before committing.
   - Lines starting with `#` are comments, which is how the synthetic marker rides along.
   - Re-importing a file replaces everything that file contributed, so it never duplicates.
2. **OPEX sheet rules.**
   - A row with a Category and no Item or Cost starts a section.
   - A row whose first cell starts with "Total" is the sheet's own totals row. Each tier column is
     compared with the computed per-week total, and 0.5 % is the pass mark (FR-ING-014).
   - Tier columns are found by name (`secure`, `indep…`, `lux…`); a blank multiplier means 1.
   - Category ids come from a Sub-category column when it holds an id (`food.groceries`),
     otherwise from `section.item` slugs, which become custom categories on commit.
3. **Cells holding spreadsheet errors** (`#DIV/0!`, `#REF!`, …) are reported with their row and
   column and skipped (FR-ING-011). Unparseable amounts and unknown period codes skip the row and
   are reported.
4. **Period codes**: `d w f m q h y`, `Ny` (every N years) and `Nv` (N visits a year). `v` alone is
   once a year.
5. **CAPEX sheet**: rows for the same item are its purchase history, and the latest is kept.
   - **Category**: guessed from the item name by keyword (laptop → `capex.computing`, holiday →
     `capex.travel`, …), else `capex.other`.
   - **Missing life**: takes the category default, flagged `lifeAssumed` (FR-CAP-005).
   - **Status**: unpaid rows are `planned`; wish-list rows are `wish`.
   - **Renewals sheet**: updates `purchasedAt` (and cost) of the asset with the same name.
6. **Assets live with the classification state.** CAPEX confirmations in the Ledger and imported
   registers feed one register.
7. **Actual vs budget** (FR-BUD-001) counts as actual spending:
   - included: posted operating spend, fees, tax and interest charged, net of refunds;
   - excluded: internal transfers, superseded pendings, capital spend (shown separately) and
     investment contributions.

   Windows:

   | Period | Window                                  |
   | ------ | --------------------------------------- |
   | Week   | The 7 days to the end date              |
   | Month  | The calendar month                      |
   | Year   | The 12 calendar months to the end month |

   Run rates average the trailing 3, 6 and 12 months, scaled to the period.

8. **Replacement timing** (FR-CAP-001):
   - Lifetimes are Weibull with shape `k` and scale from the mean, conditional on age today.
   - P10, P50 and P90 come from the closed-form conditional quantile.
   - The expected remaining life comes from numerical integration of the conditional survival
     function.
   - Replacement cost grows by `replacementCostGrowth` (real), plus CPI for the nominal figure.
9. **Sinking fund** (FR-CAP-002):
   - It is the expected real CAPEX over the horizon, divided evenly over its weeks, at a zero
     real rate.
   - Expected replacements per year come from a seeded Monte-Carlo renewal process (2 000 runs per
     asset), which also counts repeat replacements within the horizon.
   - Wish items with "buy by" count once in that year. Deferred or dropped items count zero.
10. **Annualised CAPEX** (FR-CAP-003) per tier is Σ cost / life over assets whose lowest tier is
    at or below that tier. Dropped and retired items are excluded. The budget total is operating
    spend plus annualised CAPEX.

## Consequences

The sinking fund assumes money set aside earns no real return. M5's return models can refine
that. Ages are measured from today's date, so synthetic data from an earlier window shows items
as older than they were at export.
