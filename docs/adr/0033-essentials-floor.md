# ADR 0033 — The essentials floor: no plan spends less than rent and food cost

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

A plan that can't pay the rent is not freedom (NFR-MISSION-001). Every tier, every search and every
proposal must respect a floor.

## Decision

### What the essentials are, and what they cost

- **Essentials** are categories a household can't drop: housing, utilities, phone and internet,
  health insurance, medical and pharmacy, groceries, public transport, fuel and car costs, and
  bank fees (`data-tables/essentials.json`, editable; a group id covers its categories).
- **Their cost a month** is the larger of what they cost over the last 12 months and what the
  lowest tier budgets for them. Computed with the spending input (`essentials` on
  `SpendingInput`), not scaled by the spending levers.
- **The floor** on the spending-after-freedom lever is that cost divided by the tier's budget
  (`minTierSpend`). Above 1 when the tier itself doesn't cover the essentials.

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

### Per tier

The floor is the same for every tier, because rent doesn't change with the tier. A Secure tier
budgeted below it is flagged by the check, so the fix is to update the budget or choose a higher
tier, not to "save" by not paying rent.

## Consequences

- **Honest plans:** no answer the app gives can rely on not paying for essentials.
- **Categorisation matters:** rent filed as "uncategorised" isn't counted. The synthetic households
  file rent that way, so their floor is groceries and fuel; real exports categorised by the bank
  adapters (ADR 0030) usually name rent. The Transactions screen fixes the rest.
- **Tests:** unit tests for the check and its fix, the earliest search at the floor, and which
  categories count.
