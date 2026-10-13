# ADR 0030 — Bank and accounting CSVs: presets, a learned column mapper, the same ledger

- Status: accepted (M10, third part built)
- Date: 2026-10-13
- SPEC: §6.3 (FR-ING-019…022), FR-ING-002…008, FR-ING-016, FR-SETUP-004, NFR-HON-002,
  NFR-DET-001, NFR-PRIV-001
- Builds on: ADR 0008 (CDR ingest), ADR 0014 (mapping arbitrary CSVs), ADR 0027 (chat-first setup)

## Context

Most people can't get a CDR export yet; every Australian bank and every accounting package can
export a CSV. Each lays it out differently: headerless files (CommBank, ANZ), one signed amount or
money in and out in two columns, an account column or none, day-first or month-first dates, `$`,
thousands commas, `(brackets)`, `CR`/`DR`. Accounting exports add their own view: in Xero's
Account Transactions report a _debit_ to the bank account is money in.

SPEC §6.3 listed bank CSV adapters as a later format; M10 brings them in, with "a learned
in-browser CSV mapper" (ADR 0014, FR-ING-016).

## Decision

**One pipeline.** A transaction CSV plus its _mapping spec_ becomes CDR-shaped records (accounts,
transactions and balance checkpoints), and the ledger folds them in exactly as it does CDR files:
deduplication, transfer pairing, pending → posted, reconciliation and undo (FR-ING-004…008) are not
duplicated. The CSV is stored verbatim with its spec, so the ledger rebuilds from it like any
import.

**The mapping spec** (`schemas/bank-csv-mapping.schema.json`) says which field each column holds
(date, amount, money out, money in, description, payee, balance, reference, account, category,
type, or not used), the header row, the date order, whether to flip signs, the account name and
the currency. It never carries a figure (NFR-HON-002); `src/ingest/csv/read.ts` applies it
deterministically, and the user confirms it on the Import screen.

**Three proposers, in order:**

1. **Remembered layout:** a layout the user imported before, matched by its header (or its column
   count when headerless).
2. **Presets** (`src/ingest/csv/presets.ts`): CommBank and ANZ (headerless, matched by shape),
   Westpac, NAB, ING, Xero bank statement, Xero Account Transactions, MYOB bank register (matched
   by header). They follow the providers' published layouts and are tested on synthetic files
   only; checking them on real exports is done locally, never committed (NFR-PRIV-002).
3. **The learned mapper** (`src/ingest/csv/mapper.ts`): multinomial logistic regression over
   per-column features: value statistics (dates, money, signs, decimals, text length, distinct
   values), relations between columns (a running balance that agrees with an amount or with an in −
   out pair; two money columns that are never both filled), position, and hashed header words and
   character trigrams. It is trained, seeded, on synthetic layouts from `src/ingest/csv/layouts.ts`
   (five families, shuffled columns, a dozen date and money styles, headerless files).

The Import screen shows, per column, who suggested it (**preset**, **suggested** with its
confidence, **remembered**) and every suggestion is editable (FR-ING-018).

**Learning from corrections.** On import, the confirmed layout is remembered, and every column the
model got wrong, or was unsure of, is kept as a weighted training sample (its features and the right field, not its
values). The model is retrained with them, deterministically, so a correction carries over to
other files with similar headers, not only the same layout. The memory is the `csv-mapper` record
in IndexedDB: sealed when encryption is on, in the `.budgetapp` export, removed by delete-all.

**Identity.** CSV rows have no transaction id. Each gets one hashed from the account, date, amount,
description and its occurrence among identical rows in the file, so two identical coffees on one
day stay two, and overlapping exports don't double up. The ledger marks them `idSynthetic`.

**Balances.** When a balance column agrees with the amounts row by row (oldest first or newest
first), the import adds an opening balance (start of the first day) and a closing one (end of the
last), so reconciliation (FR-REC-001) checks the file.

**Setup by chatting.** "A bank CSV" and "An accounting export" now map the files, say what each
holds, and import them; **Check the columns first** opens the Import screen (FR-SETUP-004).

## Deviation: the mapper runs in TypeScript, not ml-core

FR-ING-016 and ADR 0014 place the learned mapper in ml-core. It is a few thousand weights and
trains in under a second in the `ingest` worker, which is where the CSV is read. Putting it in
ml-core would add a WASM round trip, a TypeScript twin and a parity test for no speed or size
benefit. It moves to ml-core if it grows (a tree model, or the budget-sheet roles below).

## Not yet

- **Budget sheets.** FR-ING-016 also covers budget workbooks (row roles: section, line, totals).
  They keep the rules and the optional LLM assistant (ADR 0014) for now; the same features and
  model can take them on with a budget layout generator.
- OFX/QFX and QIF.

## Consequences

- The FR-ING-016 gate runs in CI on transaction layouts: ≥ 95 % column accuracy on held-out
  synthetic layouts, half of whose headers training never saw (`tests/eval/csv-mapper.test.ts`).
- The first suggestion in a session trains the model (under a second); later ones reuse it.
