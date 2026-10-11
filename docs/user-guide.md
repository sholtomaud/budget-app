# Using the app

::: info Status
M0–M4 are done: synthetic data, import, reconciliation, the categorised ledger, the budget, the CAPEX register and forecasts work. Other screens fill in with
later milestones ([SPEC §19](./spec.md#_19-milestones)).
:::

## Start

**Try synthetic data** generates a fictional household in your browser and loads it, so you can
explore before loading anything real. Pick a household:

- **frugal-renter**: one modest salary, a debit card, steady saving.
- **default**: one salary, renting, a credit card, monthly investing, a few lumpy purchases.
- **high-capex-crypto**: high income, heavy capital spending, weekly BTC purchases.

The seed makes it reproducible: the same household and seed always give the same data. Everything
it produces is labelled **illustrative**.

## Import

Drop files or a folder onto the Import screen, or use **Choose files** or **Choose a folder**. It
accepts Consumer Data Right (Open Banking) responses as JSON, or a ZIP of them:

| Response                                  | What it gives                                            |
| ----------------------------------------- | -------------------------------------------------------- |
| `GET /banking/accounts`                   | Your accounts and their types                            |
| `GET /banking/accounts/balances`          | Balances, used to check that no transactions are missing |
| `GET /banking/accounts/{id}/transactions` | Transactions, one page per file, in any order            |

- Files are checked against the Consumer Data Standards (v1.36.0). A file that doesn't match is
  rejected on its own, with the exact field that failed. The rest still import.
- Duplicates are dropped, even across overlapping exports. Importing the same file again does
  nothing.
- A pending transaction is replaced by its posted version when it arrives.
- Transfers between your own accounts are paired, and don't count as spending or income.
- **Reconciliation:** for each account with balance snapshots, the app checks that the
  transactions add up to the change in balance. A gap of more than $1 means pages are missing, and
  the app shows the date range.
- Balance files carry no time in the standard. Add a top-level `"x-as-at": "2025-06-30T23:59:59+10:00"`
  for exact checks; otherwise the file's date is used and labelled **assumed**.
- **Undo** in the import history removes everything that import added.

## Ledger

Every transaction is categorised automatically, in this order: what the bank data says (interest,
fees, transfers between your accounts, refunds), then your **rules**, then merchants you've
**corrected before**, then the merchant's category code, then a small model trained on your
corrections. The **Source** column says which one decided, and how confident it was.

- **Review queue**: transactions that are unclassified or low-confidence, with the merchants that
  cover the most transactions first.
- **Change a category** with the menu on any row. You're offered to **apply it to similar
  transactions** from the same merchant (and future ones), to change just this one, or to make a
  **rule**. Your own choices are never overwritten.
- **Bulk re-categorise**: tick rows (or "select all shown"), choose a category, Apply.
- **CAPEX proposals**: large or capital purchases (computers, cameras, holidays…) are proposed
  as assets. **Confirm asset** adds it to the register with a default expected life (marked
  _assumed_ until you set it); **Not capital** keeps it as ordinary spending.
- **Transfers** between your accounts and **refunds** (netted against their purchase) have their own
  views.
- Rules and remembered merchants are listed at the bottom, where you can reorder or remove them.

## Budget

Import your budget workbook as CSV, one file per sheet: the OPEX budget, CAPEX register, wish
list, renewals or goal sheet. The app recognises the sheet from its headers and shows how it read
each column. Change anything that's wrong, then import.

- For an OPEX sheet it checks the per-week totals against the sheet's own totals row. Anything
  more than 0.5 % out is flagged.
- Cells with spreadsheet errors (`#DIV/0!`, `#REF!`) are listed and skipped.
- Importing the same file again replaces it.

Then choose a **tier** (Secure, Independent, Luxury), a **period** (week, month, year) and when
it ends. For each category you see the budget, what you actually spent (net of refunds, without
transfers), the variance, and 3-, 6- and 12-month run rates. Click a category to see its
transactions. The budget total adds annualised capital spend to operating spend.

## CAPEX register

Every capital item — confirmed from the Ledger, imported from your CAPEX sheet, or added by
hand — with:

- **Replacement window**: when it's likely to need replacing. P50 is the middle; there's an 80 %
  chance it falls between P10 and P90. Edit an item's expected life to refine it.
- **Sinking fund**: how much to set aside each week, from today, to pay for the expected
  replacements over the horizon.
- **Tier**: the lowest standard of living that includes the item. The budget total per tier counts
  only its items.
- **Wish-list decisions**: buy by a date, defer, or drop.

## Forecast

Month-by-month forecasts of what you'll spend, per category and in total, 1 to 5 years ahead.
Each category's method (Holt-Winters, the historical average, Croston for occasional spending,
or simply "same as last year") is chosen by testing each against your own history. The table
shows each one's score, where below 1 beats "same as last year". The bands show the uncertainty:
the darker band holds half the likely outcomes, the lighter one 90 %. Capital spend comes from
simulating your CAPEX register thousands of times. Switch between today's dollars and dollars of
the day (inflated by your CPI assumption).

## Freedom

When could you stop working for money, and how sure can you be?

**Setting up.** The screen starts from your data:

- Your bank balance and savings accounts are filled in from your accounts.
- Money you've paid into investments starts at what you paid in. Edit it to today's market
  value.
- Take-home pay is your average over the last year.

Set the goal:

- the tier you want to live at;
- when freedom starts, and for how many years;
- a floor your capital must never fall below;
- the probability you're aiming for.

Then choose a withdrawal strategy:

- **fixed real:** spend what the tier needs;
- **percent:** a share of capital each year;
- **guardrails:** cut or raise spending when withdrawals drift;
- **skim:** live only on returns above a threshold;
- **hold:** never sell, say, your Bitcoin.

Mark super as locked until your preservation date.

**Simulate** runs 1,000 possible futures on the GSSK kernel. Each future has its own investment
returns, spending and replacement costs, all in today's dollars. Tax follows the 2025-26
Australian resident rates, Medicare levy and capital-gains discount. That table is labelled
_assumed_ until a maintainer has checked it against the ATO.

**Results:**

- **Chance of success:** the share of futures where capital stays above your floor and the tier's
  spending is always met. The same figure is shown for each tier.
- **Freedom number:** two versions.
  - The spreadsheet rule: a year's need, grossed up for tax, at a withdrawal rate. Labelled
    _assumed_.
  - **Find**: the smallest starting capital that succeeds at your target probability. Finding it
    also shows **years to freedom** if you keep working and saving as now.
- **Project runway:** how long you could fund chosen work at this tier from money you can reach
  today.
- **Capital in today's dollars:** a fan with 20 example futures and your floor.
- **What drives shortfalls:** freezes each uncertain input in turn, to show which carries the
  risk.

Under **Reproducibility**, each result records the kernel version, the wasm hash, the model and
inputs hashes, and the seed, so the same numbers can be produced again.

## Scenarios

**Save** a plan from the Freedom screen as a scenario. Tick up to four and **Compare selected** to
see them side by side. Decisions that differ are highlighted, and each result shows the chance of
success, end capital and the runs it came from. **Open in Freedom** makes a scenario your current
plan.

**What would make this likely?** asks the optimiser. Unlock the levers you're willing to move:

- when freedom starts;
- how much you spend after it;
- how much you spend until then;
- project income.

Set how far each can go. The optimiser tries plans on the same simulated futures and reports the
smallest change that reaches your target. Its **Trade-offs** table lists the plans that no other
plan beats on chance of success, spending and how soon freedom starts. Keep any of them as a
scenario.

## Screens

| Screen    | What it is for                                                                   | Milestone |
| --------- | -------------------------------------------------------------------------------- | --------- |
| Import    | CDR (Open Banking) JSON/ZIP and budget CSV files, with a mapping wizard and undo | M1, M3    |
| Ledger    | Transactions, categories, review queue, CAPEX proposals                          | M2        |
| Budget    | Budget lines by tier, actual vs budget, run rate                                 | M3        |
| CAPEX     | Asset register, replacement timeline, sinking fund                               | M3        |
| Forecast  | Fan charts per category, with method and backtest score                          | M4        |
| Freedom   | Goal editor, probability of success, capital fan chart                           | M5        |
| Scenarios | Side-by-side comparison, the optimiser and its trade-offs                        | M6        |
| Advisor   | Optional chat; every figure links to a simulation run                            | M8        |
| Settings  | Preferences, encryption, export and delete-all                                   | M7        |
| Kernel    | Shows the pinned kernel and runs an example model                                | M0        |

## Labels on numbers

Every number carries a provenance label: **actual** (bank data), **budgeted** (you entered it),
**calibrated**, **forecast**, **assumed**, or **illustrative** (synthetic or example data).
