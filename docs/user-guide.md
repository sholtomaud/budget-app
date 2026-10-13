# Using Crux

::: info Status
M0–M9 are done, with the chat panel and setup by chatting (the first part of M10): everything from import to the freedom simulation, scenarios,
encryption and export, the checked spending model, and optional AI help
([SPEC §19](./spec.md#_19-milestones)).
:::

## Set up by chatting

**Set up by chatting** on Start (or **Set up** in the menu) opens a full-screen chat that sets Crux
up with you, one question at a time:

1. **Your data.** A bank export (CDR JSON or ZIP), a budget spreadsheet, several CSV files, or a
   sample household. Bank and accounting CSV exports (MYOB, Xero) aren't readable yet; it says so
   and offers another way.
2. **Your budget.** Choose the CSV files of your spreadsheet. It shows what it found in each before
   anything is saved; **Check them in the wizard** opens the Budget screen instead.
3. **Your plan.** It runs your plan in 500 simulated futures and explains the result.

Every step has buttons, so you never have to type. You can also type an answer ("I have a MYOB
export"); Crux recognises common answers on this device. With an AI provider turned on, it asks the
AI which option you meant, with your consent, sending only that question, its options and your
message. Questions ("What does P90 mean?") are answered as usual, and setup carries on.

Setup remembers where you got to; **Start setup again** in the menu goes back to the beginning. On
a phone the menu is behind the **Menu** button. Start stays the first screen for now.

## Ask Crux (the chat panel)

The panel on the right is there on every screen. Open or close it with **Chat** at the top, or
Ctrl+J. On a phone, tap **Ask Crux**. Ask in plain words:

- **How likely is my plan to work?** It runs your plan in 500 possible futures and says how many
  work, against your target.
- **Why is it low?** and **What would make it work?** It finds the smallest change to when you
  stop work and what you spend after, and offers it as a scenario to save.
- **Where does my money go?**, **How sure is the forecast?**, **What does P90 mean?**,
  **Explain this screen.**
- Tell it about a cost: **I pay $45 a month for the gym**, **My car is 6 years old**,
  **Categorise the cafe ones as Cafes**. It shows a card with the details. Change anything, then
  **Apply**; **Undo** reverses it.

Those answers are worked out on this device, with no AI, and say **Crux · on this device**. With an
AI provider turned on (Settings), other questions go to it and say **Crux + the provider's
name**. The chip above the message box shows which screen you're on, which is sent with the
question; tap ✕ to leave it out. Conversations are kept only until you reload. **New chat**
starts again.

Small lines above each reply show what is happening as it happens:

- **Crux** lines are steps on your device, ticked off with how long they took: "Ran 500
  simulated futures · 0.8 s".
- A **Crux** line also says whenever something is sent to the AI, and how big it was.
- Lines in the AI's name are its own notes ("I'll run your plan first"). Its answer appears as it
  is written.

**Stop** cancels a request part-way; the question is then left out of the conversation.

## Plan checks

If a setting is likely to make your plan fail in a way you didn't mean, the Freedom screen says so
under **Plan checks**, in one sentence, usually with a button to fix it (and **Undo**). For example:

- **No pay before freedom.** If you've stopped working, **Start freedom now**.
- **A lot of "cash kept in the bank".** That's an everyday buffer that earns nothing; **keep about
  six months of spending there** and move the rest to savings.
- **Paid work ends before freedom starts**, or **spending more than you take home**.

The chat gives the same checks first when you ask **Why is it low?** or **What would make it
work?**, with the fixes as cards. Crux never recommends what to invest in: where your savings are
held is your decision, and a licensed adviser can help.

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

The **total** comes from a model of all your categories together, because spending categories rise
and fall together: a tight month is tight everywhere. **How sure is this?** shows the model's own
checks in plain words:

- **Sampler checks:** whether the calculation settled.
- **Moving together:** how much categories move as one.
- **Tested on the last months:** how often your last few months fell inside the forecast range.
  About 80 % is right.
- **Depends on assumptions?** How much next year's range moves if the model's starting
  assumptions are weakened or strengthened.
- **Sense check:** whether your spending is as steady as the model expected before it saw your
  data. If it isn't, that is shown in red.

Bills that never change are forecast as themselves. If the model can't settle, the total adds up the
categories instead and says so.

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

**Allow for not knowing the true average return** (on by default): nobody knows the true average
return of shares or bitcoin; it is estimated from the past. With this on, each simulated future first
picks its own average, as uncertain as 30 years of history would leave it (or as your imported
history does). Over long plans this widens the range of outcomes, and the chance of success usually
falls a little. That is honest, not pessimistic.

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
- **The chat panel** passes questions it can't answer itself to the AI. The AI can't do sums: it
  asks the app to run your plan and quotes the results, with the run they came from. Any figure
  it states that the app did not compute is marked **Unverified figure**. Changes it suggests
  come as cards for you to apply. It is not financial advice.

**Investment return history.** Upload a CSV of monthly prices (columns `Date` and `Adj Close`,
`Close` or `Price`; at least 25 months) for any investment. It then appears as a return model for
your holdings on the Freedom screen. The file stays on this device.

## Screens

| Screen    | What it is for                                                                   | Milestone |
| --------- | -------------------------------------------------------------------------------- | --------- |
| Set up    | A chat that sets Crux up with you: your data, your budget, your plan             | M10       |
| Import    | CDR (Open Banking) JSON/ZIP and budget CSV files, with a mapping wizard and undo | M1, M3    |
| Ledger    | Transactions, categories, review queue, CAPEX proposals                          | M2        |
| Budget    | Budget lines by tier, actual vs budget, run rate                                 | M3        |
| CAPEX     | Asset register, replacement timeline, sinking fund                               | M3        |
| Forecast  | Fan charts per category, with method and backtest score                          | M4        |
| Freedom   | Goal editor, probability of success, capital fan chart                           | M5        |
| Scenarios | Side-by-side comparison, the optimiser and its trade-offs                        | M6        |
| Chat      | Panel on every screen; built-in answers, optional AI, changes as cards           | M8, chat  |
| Settings  | Encryption, export, delete all; AI provider, call log, return history            | M7, M8    |
| Kernel    | Shows the pinned kernel and runs an example model                                | M0        |

## Labels on numbers

Every number carries a provenance label: **actual** (bank data), **budgeted** (you entered it),
**calibrated**, **forecast**, **assumed**, or **illustrative** (synthetic or example data).
