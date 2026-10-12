# ADR 0025 — Negative spending is no spending; no valid runs is an error, never 0 %

- Status: accepted
- Date: 2026-10-12
- SPEC: §11 (simulation), FR-SIM-003 (money balance), NFR-HON-002, NFR-MISSION-001

## Context

The project owner reported a plan that the app said works in **0 %** of futures, while even the
worst tenth of futures ended with about $1.8 million (P10) and the freedom number showed **$0**.

**How we found it.** It was reproduced on the sample household:

- When the spending used for the plan adds up to less than zero, every simulated run fails the
  money-balance check (FR-SIM-003). Negative spending makes money appear from nowhere.
- The success rate is taken over valid runs only, and with none it was reported as 0 %.
- Capital grows untouched, because nothing is spent.
- The freedom number clamps a negative need to $0.

**How spending goes negative.** Spending per group is the 12-month average of transactions in
spending categories, and money in counts against it (refunds, as intended). When pay, or a transfer
in, is filed under a spending category, by hand or by an AI suggestion, that group nets to money
in. Enough of it makes the total negative.

Telling someone their plan has no chance, when it is the app that is wrong, is the opposite of the
mission: it creates financial stress from nothing.

## Decision

1. **A spending group never counts as negative.**
   - `spendingFrom` sets a group that took in more than it spent over the last 12 months to $0.
   - It reports those groups as `credits`.
   - The Freedom screen and the chat's "How likely is my plan to work?" answer name them, and say
     that pay or a transfer may be filed under a spending category.
2. **The simulator never spends a negative amount** in a month. This is the last guard, if bad
   inputs ever arrive another way.
3. **No valid run is an error, not a result.** `combine` throws `NoValidRunsError` ("… This is a
   fault in the app, not a verdict on your plan"). Each screen, and the chat, shows that message
   instead of a percentage.

## Consequences

- **A mislabelled transaction can no longer turn into a false 0 %.** It shows as a named warning
  instead, pointing at where to fix it.
- **The chance of success is always over at least one valid run.** The Freedom screen still says
  how many runs, if any, were excluded.
- **Tests:** a unit test files pay under groceries and checks the clamp and the warning. Kernel
  tests check that negative spending simulates validly and that all-invalid results throw. Both
  failed before the fix.
