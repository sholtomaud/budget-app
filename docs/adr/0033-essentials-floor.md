# ADR 0033 — The floor: no plan spends less than the Secure budget

- Status: accepted
- Date: 2026-10-13
- SPEC: §11.4, FR-OPT-001, FR-OPT-006, FR-OPT-008 (new), §13.3, NFR-MISSION-001
- Builds on: ADR 0013 (optimiser), ADR 0026 (plan checks), ADR 0031 (earliest date), ADR 0032 (Run
  my plan)

## Context

The project owner's plan came back "working" at 63 % of the Secure tier after freedom. Their rent
alone is about $700 a week; 63 % of Secure (about $1,400 a month) can't pay it. How it got there:

- the Secure tier's budget (about $2,200 a month) was already less than the rent and groceries
  actually cost;
- "What would make it work?" may scale spending after freedom down to 70 % of the tier, and the
  AI's proposals had no lower bound at all;
- nothing compared spending after freedom with what the essentials cost.

A plan that can't pay the rent is not freedom (NFR-MISSION-001). Every search and every proposal
must respect a floor, and the person has already said where it is: their Secure tier.

## Decision

### The floor is the Secure budget

- **The lowest tier is the floor.** Tiers are the person's own definition of how they could live:
  Secure (the essentials), Independent, Luxury. Every budget line carries a multiplier per tier,
  so the Secure tier is each line at its Secure multiplier; a line that tier leaves out (multiplier
  0, a luxury) adds nothing. That total, a month, is the least a plan may spend after freedom.
- **Per tier:** a plan at Independent may come down to the Secure total, not below; a plan at
  Secure has no room below its own budget. The floor on the spending-after-freedom lever is the
  Secure total divided by the plan tier's (`minTierSpend`).
- **Out of date?** Where a group the floor depends on (housing, utilities, phone and internet) has
  actually cost well more over the last 12 months than the Secure budget gives it (over 15 % and
  $50 a month), a plan check notes it: if rent has gone up, the floor is too low until the budget
  is updated.
- **No budget yet:** what the essentials (`data-tables/essentials.json`: housing, utilities, phone
  and internet, health, groceries, transport, bank fees) cost over the last 12 months stands in.

### Who respects it

- **Plan checks:** a problem, with a fix, when spending after freedom is below the floor. The text
  names the biggest essentials and says whether the tier's budget or the lever is the cause.
- **What would make it work? (FR-OPT-001):** the spending lever's lower bound is at least the
  floor; a plan below it is searched from the floor.
- **The earliest date (FR-OPT-006):** a setup below the floor is searched at the floor; the
  spend-less plan never goes below it, and is left out when the floor leaves no room.
- **The AI:** `get_plan` returns what the essentials cost and the lowest spending after freedom;
  `propose_plan` raises a proposal below the floor and says so; the system prompt forbids
  suggesting one.

### Spreadsheet budgets

Budgets exported from a spreadsheet like the project owner's import as they are: the header is
found below a title row; the tier multipliers come from the "Fin. Secure / Indepnt / Luxury"
columns, not the sheet's own weekly totals; reading stops at TOTALS, so calculators below it are
ignored; rows with no period (notes, calculations) and amounts that aren't money ("33%") are
skipped with a reason; a section label beside an item still starts a section.

## Consequences

- **Honest plans:** no answer the app gives can rely on not paying for essentials.
- **The budget matters:** the floor is only as good as the Secure budget, which is why an
  out-of-date one is pointed out. Without a budget, rent filed as "uncategorised" isn't counted
  (the synthetic households file it that way); the Transactions screen fixes that.
- **Tests:** unit tests for the check and its fix, the earliest search at the floor, and which
  categories count.
