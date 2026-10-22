# ADR 0046 — Budget lines that end

- Status: accepted
- Date: 2026-10-22
- SPEC: §5 BudgetLine, §9.2 FR-BUD-005 (new), §11.3 FR-GOAL-024
- Builds on: ADR 0012 (the freedom simulation), ADR 0042 (editing the budget), ADR 0045 (the
  spending in parts)

## Context

A budget line ran for the whole plan. The project owner's mortgage (about $3,000 a month) was
counted in every month of a 31-year plan, though it will be paid off long before that. A plan
that pays off a mortgage needs much less capital than one that pays it forever, so the freedom
number and the chance were both too pessimistic, by a lot. Loans, school fees and child care are
the same.

## Decision

1. **A line may have a last month paid**: `BudgetLine.endDate`, `YYYY-MM`. It counts up to and
   including that month and as nothing after (`endedBy`, and `weeklyRate`'s optional month).
   Without it, the line runs on, as before.
2. **Plans.** `spendingFrom` leaves out lines that ended before the simulation starts. Lines that
   end later are counted, and listed in `SpendingInput.ends` with the month they stop and their
   monthly amount at the tier, scaled by the spending lever like the rest. The controller takes
   them off after-freedom spending from that month, in every simulated future.
3. **The freedom number's year of spending** is what is still paid when freedom starts: a mortgage
   that ends before then isn't in it. Its parts (ADR 0045) name the lines that end during freedom
   and when. The number itself is a constant need over a withdrawal rate, so it still counts them
   as if forever. The freedom number at the target, from the simulation, counts them properly.
4. **Where it is set:**
   - an "until" month on each line on the Budget screen;
   - an End date column in a budget sheet (aliases: ends, until, last payment, paid off; a year
     alone means through December);
   - a "Last month paid" field on the chat's budget-line card;
   - the AI's `propose_budget_line` (`lastMonth`);
   - in words for Crux's own pattern: "until March 2038", "till 2038", "for 12 more years".
5. **Kept across re-imports.** The end is part of a line's sheet values. An end set here stands
   until the sheet itself changes that row (ADR 0042).
6. **Budgets for a period** (actual vs budget, the budget review, the forecast's budget prior)
   leave out lines that ended before the period. A line that has ended is marked "ended" on the
   Budget screen.

## Consequences

- A mortgage, loan or fee that stops is planned as stopping. For the project owner, a mortgage
  ending during freedom now lowers the freedom number at the target and raises the chance.
- **Spending before freedom still comes from what was actually spent** (the ledger), not from the
  budget. A line that ends while the person is still working changes nothing until freedom: the
  ledger shows the end once it happens. A budget that differs from what is spent is the budget
  review's job (ADR 0038).
- **The essentials floor (ADR 0033)** is the Secure budget as it is now, including a line that
  ends during freedom. Plans can't spend less than today's essentials even after the mortgage is
  paid off: conservative, and simple to explain. A floor that steps down with the lines that end is
  a possible later change.
- The simple freedom number is unchanged in kind (one year's need at the start, forever), so it
  overstates when a big line ends early in freedom. The breakdown says so by naming those lines.
