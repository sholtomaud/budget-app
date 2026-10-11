# ADR 0008 — CDR ingest and synthetic data (M1)

- Status: accepted
- Date: 2026-10-11
- SPEC: §6.1, §7 refined; amended to match in Draft 3

## Decisions

1. **Pinned standard.** The importer validates against the Consumer Data Standards **v1.36.0**
   Banking API (`src/ingest/cdr/VERSION`). `scripts/cdr-schemas.ts` derives `schemas/cdr/*.schema.json`
   from that release's OpenAPI document: `ResponseBankingAccountListV3`,
   `ResponseBankingAccountsBalanceList` and `ResponseBankingTransactionListV2`. In v1.36.0,
   `reference` is required on transactions, and accounts require `accountOwnership`,
   `maskedNumber` and `productName`. Unknown fields are allowed and kept in `raw`. The standard's
   `x-cds-type` formats (`AmountString`, `DateTimeString`, …) are enforced by the in-house
   validator.
2. **Balance times.** CDR `BankingBalance` has no observation time, so reconciliation could not
   place a balance in time. budget-app reads an optional top-level **`x-as-at`** (ISO 8601 with
   offset) on a balances response. Without it, the file's modification time is used and the
   checkpoint is labelled `assumed`. The generator writes one balances file per snapshot
   (`balances/<date>.json`, each with `x-as-at`) instead of a single `balances.json`.
3. **Imports are stored verbatim and the ledger is rebuilt.** Each import's accepted files are
   kept in IndexedDB. The ledger is the fold of all imports in order, and undo deletes an import and
   rebuilds (FR-ING-006). Links (pending → posted, transfer pairs) are recomputed from scratch in a
   canonical order, so the ledger never depends on import order. A property test checks this.
4. **Synthetic ids** (FR-ING-004): `H-` + the first 32 hex digits of SHA-256 over
   `accountId␟(postingDateTime|executionDateTime)␟amount␟description`.
5. **Pending → posted** (FR-ING-005): same account and amount, posted 0–7 days after the pending
   date, with token similarity ≥ 0.5. Similarity is a Dice coefficient where truncated tokens
   match their full form, since banks truncate pending descriptions.
6. **Internal transfers** (FR-ING-007): equal and opposite posted amounts on two different
   accounts that are both in the ledger, within 3 days. Ties go to the smallest gap, then to the
   `TRANSFER_*` types.
7. **Persona interpretation** (§7.2):
   - `every: year` items buy once per calendar year, in one of the listed months.
   - Wish items buy at most once, with `buyProbPerYear`.
   - Items with a life and no `lastBought` get one drawn uniformly within their life, flagged
     `lastBoughtAssumed` in the truth file.
   - The credit card is paid in full on the 25th. Savings top up the transaction account when it
     would go negative. Surplus above twice the buffer is swept to savings at month end.
   - Card purchases still unposted at the export date appear as `PENDING`.
8. **Budget CSV files** in an import are skipped, not rejected, until the M3 budget importer.
9. **Truth keys** are `accountId/transactionId`, with the synthetic id for records without one.

## Consequences

Real exports need `x-as-at` added, or a trustworthy file time, for reconciliation to mean
anything; the UI says when a checkpoint time is assumed. Rebuilding on undo is O(total data),
measured at about 0.5 s for 10 000 transactions.
