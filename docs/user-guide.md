# Using Crux

::: info Status
M0–M7 are done: everything from import to the freedom simulation, scenarios, encryption and export.
The optional AI assistant arrives with M8 ([SPEC §19](./spec.md#_19-milestones)).
:::

## Getting started

The Start screen says what Crux does in a few lines. A **guide** under the menu then walks you
through the screens in order, one plain sentence each:

1. Add your data, or try a sample household.
2. Check your transactions.
3. Compare with your budget.
4. Plan for big purchases.
5. See what's coming.
6. Find your freedom number.
7. Compare plans.

A step ticks off once you've opened its screen. **Next** takes you to the following one, and
**Hide guide** tucks it away. Settings → Help, or **Start the guide again** on the Start screen,
brings it back.

## Start

**Try it with a sample household** generates a made-up household in your browser and loads it, so
you can explore before loading anything real. Pick one:

- **Frugal renter**: one modest salary, a debit card, steady saving.
- **Renting, one salary**: a credit card, monthly investing, a few big purchases.
- **High earner, big purchases, crypto**: high income, heavy capital spending, weekly Bitcoin
  purchases.

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

## Settings: encryption, export, delete

**Encryption** keeps everything on this device encrypted with a key protected by your passphrase.
The app asks for the passphrase when it opens. It locks itself after 15 minutes idle (you can
change that), and **Lock now** locks it at once. If you forget the passphrase, the data can't be
recovered by anyone, so keep an export. Changing the passphrase is instant. Turning encryption off
asks for it again.

**Export** saves everything in one `.budgetapp` file: your imports, categories and rules, budget,
CAPEX register, freedom setup and scenarios. The file is encrypted with the passphrase you choose
for it. **Import an export** restores a file, replacing what's on this device.

**Delete all data** removes everything the app stored in this browser, including the offline copy.

## Settings: AI provider and the advisor (optional)

Everything above works with no AI at all. If you want help from an AI model, choose a provider
under **AI provider (optional)**: Anthropic (Claude), Google Gemini, or any OpenAI-compatible service, including
one running on your own computer (Ollama, LM Studio, llama.cpp at `localhost`). Paste an API key.
**The key is kept only while the app is open.** It is never saved on this device or put in an
export, and reloading or locking forgets it. **Forget key** removes it at once.

Before anything is sent, the app shows you exactly what will go, and to where. **Don't send** sends
nothing. Account numbers, card numbers, emails and phone numbers are removed first, and amounts are
shown only as ranges ("$50–100") or rounded ("~$650,000"). **Calls made (log)** lists every call:
when, to whom, for what, how many bytes.

With a provider on:

- **Ledger → Review → Suggest categories with AI** suggests categories for the transactions still
  waiting for review. Suggestions are marked as the model's, and your own choices always win.
- **Budget → import wizard → Ask AI to map columns** suggests which column is which for a budget
  CSV in an unusual layout. Check it in the preview before importing.
- **Advisor** answers questions about your plan ("How likely is my plan to work?"). It can't do
  sums itself: it asks the app to run your plan and quotes the results, with the run they came
  from. Any figure it states that the app did not compute is marked **Unverified figure**. Plans it
  proposes are saved under **Scenarios** marked "Advisor", for you to look at. It is not financial
  advice.

**Investment return history.** Upload a CSV of monthly prices (columns `Date` and `Adj Close`,
`Close` or `Price`; at least 25 months) for any investment. It then appears as a return model for
your holdings on the Freedom screen. The file stays on this device.

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
| Advisor   | Optional chat; figures come from simulation runs, others are flagged             | M8        |
| Settings  | Encryption, export, delete all; AI provider, call log, return history            | M7, M8    |
| Kernel    | Shows the pinned kernel and runs an example model                                | M0        |

## Labels on numbers

Every number carries a provenance label: **actual** (bank data), **budgeted** (you entered it),
**calibrated**, **forecast**, **assumed**, or **illustrative** (synthetic or example data).
