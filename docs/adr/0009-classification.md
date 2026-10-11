# ADR 0009 — Classification (M2)

- Status: accepted
- Date: 2026-10-11
- SPEC: §8 refined; amended to match in Draft 4

## Decisions

1. **Classification runs in the `ingest` worker**, not a separate `classify` worker. It reads and
   annotates every transaction. A separate worker would copy the whole ledger across a worker
   boundary on every change, for no gain at this size: about 2 000 transactions classify in tens
   of milliseconds.
2. **Stages, first confident answer wins** (§8):
   1. Structural: CDR type, transfer pairs, and refunds.
   2. User rules, ordered, confidence 1.
   3. Merchant memory, confidence 0.95.
   4. MCC map, confidence 0.8.
   5. Naive Bayes model, confidence = posterior.
   6. LLM (M8).
   7. Unclassified.

   The user's own label is always final (FR-CLS-004).

3. **Merchant memory** keys on the normalised payee: the merchant name if present, else the biller
   name, else the description, after dropping store numbers, card prefixes (`SQ *`), company
   suffixes, leading payment-method words (`DIRECT DEBIT`, `BPAY`, `TRANSFER TO`) and case. Recall
   takes the longest remembered key that is a prefix of the transaction's tokens, so suburbs and
   store suffixes after the name don't matter. Memory is per direction: a refund from a shop is
   not a purchase. A remembered capital merchant applies only to purchases of AUD 200 or more.
4. **MCC map** (`data-tables/mcc-categories.json`). An entry can name a `capexCategory` and a
   `capexFrom` amount, so a $4 200 laptop and a $15 cable from the same electronics code land in
   different places.
5. **The model** is multinomial naive Bayes over 2¹⁴ hashed features: payee words and character
   trigrams, MCC, amount bucket, weekday and CDR type. It trains on the user's own labels only, and
   only once there are at least 2 categories and 5 labels. It is retrained from the stored labels
   on load instead of persisting weights (§8 said "persisted as weights"). Retraining takes
   milliseconds and avoids a weights migration whenever features change.
6. **CAPEX proposals** (FR-CLS-002): a debit is proposed when its category is capital, or when it
   is at least AUD 200 and more than 4× its category's median (with at least 5 transactions in the
   category). Confirming creates or links an `Asset` with the category's default life from
   `data-tables/asset-lifetimes.json`, flagged `lifeAssumed`. Rejecting records it as operating
   spend.
7. **Refunds** (FR-CLS-003): a credit on the same account for the same amount, within 60 days of
   a debit, with a similar payee. It takes the original's category and nets against it.
8. **The review queue** is every live transaction that is unclassified or below 0.6 confidence. It
   lists the largest payee group first, so each correction covers the most transactions.
9. **Evaluation** (§16.2): a simulated user works the queue, largest group first, then fixes the
   most common remaining mistake. Each correction is applied to similar transactions. The CI gates
   are FR-CLS-005 (default persona: category ≥ 95 %, kind ≥ 98 % after 50 corrections) and CAPEX
   precision and recall ≥ 0.9 on `high-capex-crypto`.
10. **More realistic synthetic data**: personas now emit card purchases with missing
    (`missingMcc`) and miscoded (`wrongMcc`) merchant category codes, as real exports do.

## Consequences

Synthetic payees recur so consistently that memory reaches 100 % after 10–20 corrections. Real
data will be harder, so the model stage matters more there. The eval page (`/eval`, dev builds)
shows per-stage counts and the kind confusion matrix to watch this.
