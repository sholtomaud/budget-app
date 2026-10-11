# Using the app

::: warning Milestone M0
The app is a skeleton. The screens are in place, but most fill in during later milestones
([SPEC §19](./spec.md#_19-milestones)).
:::

## Start

Choose **Try synthetic data** to explore with a generated household (from M1), or **Import my
data** to load your own files. Nothing you load leaves your browser.

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
