# ADR 0034 — Budget lines onto standard categories: rules, then a structured output

- Status: accepted
- Date: 2026-10-14
- SPEC: §6.2, FR-ING-015…019 (019 new), §13.1, NFR-HON-002, NFR-PRIV-003
- Builds on: ADR 0014 (mapping spec), ADR 0021 (providers and the egress gate), ADR 0027 (setup by
  chatting), ADR 0033 (the floor)

## Context

A budget from a spreadsheet names its lines its own way: "Super.Market" under FOOD, "Elect" and
"Water" under UTILITIES with the sub-category "utilities", "Rent" with the sub-category "rental".
The importer filed them as `section.sub-category` (`housing.rental`, `utilities.utilities`), while
transactions are on the app's categories (`housing.rent`, `utilities.electricity`). Actual vs budget
matches by category, so rent showed twice: once as budget with no actual, once as actual with no
budget. The floor (ADR 0033) and the Bayesian model need both sides on the same categories.

The Budget wizard had a per-category mapping, but at the sheet's granularity (Elect and Water
share `utilities.utilities`, so they couldn't go to different categories), and setup by chatting
skipped it entirely.

## Decision

### A standard to map onto

The app's default categories carry their **COICOP 2018** division or group (the UN Classification
of Individual Consumption According to Purpose, used by statistics offices for household spending:
01 food, 03 clothing, 04 housing and utilities, 06 health, 07 transport, 08 information and
communication, 09 recreation, 10 education, 11 restaurants, 12 insurance and financial services,
13 personal care). Ids stay as they are; the code is an attribute. Categories outside consumption
(income, investment, tax, transfers, mortgage repayments) have none. Education, personal care,
furnishings, home maintenance and other insurance were added to cover the divisions the defaults
missed.

### Per line, in three steps

Mapping is per budget line (by its source row), so lines that share a sub-category can land in
different categories.

1. **Rules on the device** (`src/budget/category-map.ts`): the item, then its sub-category, then
   its section, against words for each category ("rental" → Rent, "Super.Market" → Groceries,
   "Elect" → Electricity, "Body Corp" → Strata and rates). A line already on an app category keeps
   it ("the sheet").
2. **The AI, for what the rules leave**, when a provider is set up: a structured output whose
   schema allows only the app's spending category ids, or `none`. It is sent each line's row,
   item (redacted), section and sub-category, with the category list and COICOP codes; never an
   amount, date, note or link. Consent and the call log as for every call (purpose
   `budget-categories`). The answer is validated locally: only rows that were asked about, only
   known categories, one per row.
3. **The person confirms.** The Budget wizard shows every line with its category, who set it (the
   sheet, rules, AI or you) and a select to change it, with "Match the other N with AI". Setup by
   chatting shows how many lines were matched and by whom, lists the AI's matches, and imports on
   "Import them"; the wizard remains for line-by-line changes. Without a provider and key, the AI
   buttons are off and the wizard says how many lines (or which columns) are left, with a link
   to set up AI in Settings; the sheet opens again when the person comes back to Budget. A budget
   sheet chosen on the Import screen (tier columns, or most of a CAPEX or wish-list header) opens
   in this wizard rather than the bank-CSV column mapper.

The importer applies the person's per-category mapping first, then the per-line categories
(`lineCategories`), then the sheet's own names.

## Consequences

- **Actual vs budget lines up**, and with it the floor and the out-of-date note.
- **No figures leave the device** to match categories; a budget with only common items needs no AI
  at all (the project owner's 25 lines: 23 by rules).
- **A standard to compare with:** COICOP codes make published household spending (ABS, labelled
  _assumed_) a later comparison, not a new mapping.
- **Tests:** unit tests for the codes, the rules, the prompt (no amounts), the schema, the checked
  answer and the importer's order; e2e for the wizard's table, the AI button with a mocked
  provider, the person's override and the import.
