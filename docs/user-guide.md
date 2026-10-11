# Using the app

::: info Status
M0–M2 are done: synthetic data, import, reconciliation, and the categorised ledger work. Other screens fill in with
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

## Screens

| Screen    | What it is for                                                                   | Milestone |
| --------- | -------------------------------------------------------------------------------- | --------- |
| Import    | CDR (Open Banking) JSON/ZIP and budget CSV files, with a mapping wizard and undo | M1, M3    |
| Ledger    | Transactions, categories, review queue, CAPEX proposals                          | M2        |
| Budget    | Budget lines by tier, actual vs budget, run rate                                 | M3        |
| CAPEX     | Asset register, replacement timeline, sinking fund                               | M3        |
| Forecast  | Fan charts per category, with method and backtest score                          | M4        |
| Freedom   | Goal editor, probability of success, capital fan chart                           | M5        |
| Scenarios | Side-by-side comparison and the optimiser                                        | M6        |
| Advisor   | Optional chat; every figure links to a simulation run                            | M8        |
| Settings  | Preferences, encryption, export and delete-all                                   | M7        |
| Kernel    | Shows the pinned kernel and runs an example model                                | M0        |

## Labels on numbers

Every number carries a provenance label: **actual** (bank data), **budgeted** (you entered it),
**calibrated**, **forecast**, **assumed**, or **illustrative** (synthetic or example data).
