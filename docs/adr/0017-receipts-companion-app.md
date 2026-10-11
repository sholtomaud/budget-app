# ADR 0017 — Receipts: an iOS companion app, line items reconciled to bank transactions

- Status: proposed (milestone M13; separate repository)
- Date: 2026-10-11
- SPEC: §6.5 (FR-RCPT-001…007)

## Context

Bank data gives one line per payment ("BYTEWISE COMPUTERS $4 200"). A receipt gives the items: a
laptop and a sleeve, with the warranty and serial number. Line items would improve several things:

- split categories, such as a supermarket run that includes a kettle;
- CAPEX detection and the asset register (model, serial, warranty end);
- replacement-cost growth;
- refund matching.

## Decision

1. **A native iOS app in SwiftUI, in its own repository** (`budget-app-receipts`). It has its own
   release cycle, App Store review and Swift toolchain. It shares only a versioned JSON contract
   with this repo.
2. **On-device capture and OCR:** VisionKit document scanning and the Vision framework's text
   recognition. No image or text leaves the phone by default.
   - On-device parsing (merchant, date, total, tax, line items) uses rules plus a small Core ML
     model.
   - An optional LLM fallback for hard receipts follows the same consent, redaction and
     structured-output rules as §13 and ADR 0014. It is labelled when used.
3. **A receipt contract:** `schemas/receipt.schema.json`, versioned, carrying `x-synthetic` in
   fixtures. It holds merchant, ABN if printed, datetime, currency, total, tax, payment hint (last
   4 digits of the card if printed) and line items (description, quantity, unit price, amount,
   suggested category), each with its OCR confidence. Totals are checked: the lines must sum to the
   total within rounding, or the receipt is flagged.
4. **Transfer to the web app:**
   - through the user's own sync storage (ADR 0016), using the shared encrypted event log;
   - or as a file the web app imports (share sheet → `.receipt.json`);
   - or a QR or local-network handoff.

   There is no server of ours in the path.

5. **Reconciliation in the web app** (FR-RCPT-004…006):
   - A receipt matches a bank transaction by amount (exact, or within a tip or surcharge
     tolerance), date (±3 days, after settlement lag), and merchant similarity (the same Dice
     tokens as pending→posted).
   - Matched receipts attach line items to the transaction. The transaction's category can be
     split by line, and capital items create or link assets (warranty, serial).
   - Unmatched receipts stay pending (cash, another account), with the same review queue as the
     ledger.
6. **Synthetic receipts:** the synth generator emits receipts for its CAPEX and grocery purchases,
   so reconciliation is tested end to end without real data (NFR-PRIV-002).

## Consequences

- An Apple developer account, and App Store privacy labels ("data not collected").
- An Android app is not planned. The receipt contract makes one possible.
- Receipt images stay on the phone unless the user chooses to sync them.
