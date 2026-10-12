# Crux — Specification

*Crux* is the product name (ADR 0020). The repository, package and internal identifiers keep
`budget-app`.

| | |
|---|---|
| Status | Draft 16: M0–M9, the chat panel and plan guidance built (ADRs 0001–0013, 0019–0026); M10–M14 planned, with proposed directions in ADRs 0014, 0016–0018 |
| Date | 2026-10-12 |
| Kernel | [GSSK](https://github.com/energese-project/GSSK-Giannantoni), consumed as a pinned WebAssembly artefact |
| Runtime | Browser only. Static site, no backend |

Requirement IDs (`FR-…`, `NFR-…`, `KR-…`) are stable and are meant to be cited from issues, PRs and
tests. "MUST", "SHOULD" and "MAY" carry their RFC 2119 meanings.

---

## 1. Purpose

A household budget is usually a spreadsheet that answers "what do I spend?" at one point in time. This
app answers the questions that a spreadsheet cannot:

1. **What did I actually spend**, by category, against the budget? (Bank data, not estimates.)
2. **What will I spend**, including lumpy capital purchases (laptops, watches, pens, holidays), with
   uncertainty rather than a single number?
3. **Is my capital enough to live on passive cashflow** — at a chosen standard of living — for the
   rest of my life, and with what probability?
4. **What has to change** (savings rate, spending tier, CAPEX deferrals, allocation, withdrawal
   strategy) to make that probability acceptable?

The motivating goal is *freedom capital*: a capital base whose passive cashflow funds a chosen life,
so that time can go to work chosen for its value rather than its pay (for example, open research such
as GSSK). The app treats that as a measurable goal, not a slogan (§11).

**Mission (NFR-MISSION-001, non-negotiable).** The app is a cybernetic controller whose overriding
purpose is to move people out of financial stress and towards freedom. It measures where a
household is, forecasts where it is heading, and steers it with honest feedback. It looks after
its users; it never exploits them.

Every feature is judged by whether it serves this mission. Commercial features (§22) are judged
first. Anything that profits from a user's stress, impulse or vulnerability is out of scope,
whatever it would earn.

### 1.1 Non-goals

- **No server of ours holding user data, and no account of ours.** All data stays in the browser
  unless the user exports it, invokes an external API (§13), or turns on sync to cloud storage they
  own (§14.1, M12). That sync is end-to-end encrypted, and signing in to the storage provider is
  the only account.
- **No direct bank connection in v1.** Becoming an accredited CDR data recipient is out of scope.
  The app ingests files in the CDR (Open Banking) format that the user obtains elsewhere, plus
  synthetic data (§6, §7). Live connections are planned as an optional production milestone
  (§6.4, M11).
- **No financial advice.** The app simulates consequences of the user's own assumptions. Every output
  states its assumptions (NFR-HON-001). Tax rules are user-verifiable data files, not authority.
- **No trading and no write access to any account.** Purchases made by the user's agent (§22, M14)
  go through a merchant's own checkout under a mandate the user approved, never through bank
  access.
- **No sale or sharing of users' personal, transaction or CDR data** (NFR-MON-001). Commerce
  features compute relevance on the device (§22).
- **No changes to GSSK to make the app work.** Gaps are worked around in the app and recorded as
  kernel requests (§17). The app MUST run against an unmodified, pinned GSSK release.

---

## 2. Principles

| ID | Principle |
|---|---|
| NFR-MISSION-001 | **Mission first.** The app exists to move people out of financial stress (§1). No feature, partner or revenue stream may target, exploit or deepen financial stress. Where a commercial interest and the user's interest conflict, the user's wins, and the conflict is disclosed. Changing this principle is out of scope for any PR. |
| NFR-PRIV-001 | **Local-first.** Real financial data lives only in browser storage (IndexedDB/OPFS) on the user's device. |
| NFR-PRIV-002 | **The repository holds code and synthetic data only.** No real statement, workbook, balance, address or account number is ever committed. CI enforces this (§16.4). The repository may be public. |
| NFR-PRIV-003 | **No silent network.** At runtime the app makes no network request except (a) loading its own static assets and (b) calls to an external API the user has configured and confirmed for that call (§13). An automated test asserts this. |
| NFR-PRIV-004 | **User-owned storage.** Cloud copies live only in storage the user owns and signs in to (Google Drive first; §14.1), end-to-end encrypted. We host no household data. |
| NFR-MON-001 | **The user is the customer.** Monetisation never sells or shares personal, transaction or CDR data. Offer relevance is computed on the device. Paid placement is always disclosed and never influences the advisor's figures. Commerce features are off by default and the app is complete without them (§22, ADR 0018). |
| NFR-HON-001 | **Every number is labelled** with its provenance: `actual` (from bank data), `budgeted` (user-entered), `calibrated` (fitted by GSSK to actuals), `forecast` (statistical model), `assumed` (user or default assumption), `illustrative` (synthetic data). The label travels with the number into every chart and export. Adapted from GSSK's own output labelling. |
| NFR-HON-002 | **An LLM never produces a number.** It may propose inputs or changes; every figure shown is the output of a deterministic computation with a run ID (§13). |
| NFR-DET-001 | **Deterministic.** Every stochastic step (synthetic data, bootstrap, Monte-Carlo, optimiser) takes an explicit seed. Same inputs + same seed ⇒ bit-identical outputs on the same browser engine. |
| NFR-KER-001 | **GSSK is a pinned dependency.** The app vendors `gssk.wasm` + loader from a named GSSK commit/tag and verifies its SHA-256 at load. Upgrading the kernel is a deliberate PR. |

---

## 3. Users and use cases

Primary user: one household (one or two adults), technically literate, in Australia (AUD, ATO tax
rules, superannuation). Multi-currency holdings (BTC, USD, EUR) are first-class.

| ID | As a user I want to… |
|---|---|
| UC-01 | load several months of bank transactions in CDR format and see them categorised. |
| UC-02 | correct a category once and have similar transactions follow. |
| UC-03 | see actual vs budget per category, per week/month/year, for each spending tier. |
| UC-04 | import my existing budget workbook (exported sheet by sheet as CSV) so I do not re-enter it. |
| UC-05 | keep a register of capital items (asset, cost, purchase date, expected life) and see when replacements fall due and what they cost per week. |
| UC-06 | have new large purchases detected in the bank data and offered as CAPEX register entries. |
| UC-07 | see forecast OPEX and CAPEX for the next 1–5 years with uncertainty bands. |
| UC-08 | define my freedom goal (tier, start date, horizon, floor) and see the probability of meeting it. |
| UC-09 | compare strategies (e.g. skim returns vs hold; rent vs buy; tiers) side by side. |
| UC-10 | ask "what would make this 90% likely?" and get concrete, simulated options. |
| UC-11 | ask questions in plain language about my finances and get answers that cite simulation runs. |
| UC-12 | try all of the above on synthetic data before loading anything real. |
| UC-13 | export everything as one encrypted file and restore it on another device. |

---

## 4. Architecture

```
┌──────────────────────────── Browser (static site) ─────────────────────────────┐
│                                                                                │
│  UI (main thread)                                                              │
│   Ledger · Budget · CAPEX · Forecast · Freedom · Scenarios · Advisor · Settings │
│        │ typed postMessage RPC (in-house)                                      │
│  ┌─────▼──────────────────── Web Workers ───────────────────────────────────┐  │
│  │ ingest      CDR JSON → canonical; CSV → budget/CAPEX/goals               │  │
│  │ classify    rules → memory → MCC → ML → (optional) LLM (in ingest)       │  │
│  │ forecast    ml-core.wasm: ETS, Croston, bootstrap, Weibull, quantiles    │  │
│  │ modelgen    canonical state → GSSK model JSON (pure function)            │  │
│  │ sim         gssk.wasm: Init/Step/Reset/SetEdgeK + policy controller      │  │
│  │             Monte-Carlo runner, calibration, run store                   │  │
│  │ optimise    decision search over sim                                     │  │
│  │ synth       seeded synthetic household → CDR JSON + truth labels         │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│        │                                                                       │
│  Storage: IndexedDB (records) · OPFS (large run outputs) · optional encryption │
│                                                                                │
│  Optional egress, per-call consent: LLM API · market-price API                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

Every worker exposes a typed, promise-based interface. The UI never touches WASM memory directly.

**Why GSSK rather than plain JavaScript arithmetic.** GSSK gives the app: an explicit stock-and-flow
model whose money balance is checked every step (FR-SIM-003); a
mutation log that records *why* each rate changed (`cause`), so every policy decision in a run is
auditable and replayable (`GSSK_Replay`); gradient calibration of behavioural rates against actual
balances (`GSSK_CalibrateGradient`); and room to add non-money carriers later (household energy,
time) in the same model. Policy (tax, withdrawals) stays in the app; dynamics stay in the kernel.

---

## 5. Canonical data model

All persisted records carry `id`, `createdAt`, `updatedAt`, and `provenance` (NFR-HON-001). Money is
stored as **integer minor units** (cents) with an ISO 4217 or asset code; conversions are explicit
records, never implicit floats.

```ts
type Provenance = 'actual' | 'budgeted' | 'calibrated' | 'forecast' | 'assumed' | 'illustrative';
type Money = { minor: bigint; ccy: string };          // 'AUD', 'USD', 'BTC' (sats), …

interface Account {
  id: string;                 // CDR accountId (opaque)
  displayName: string;
  productCategory: string;    // CDR BankingProductCategory, e.g. TRANS_AND_SAVINGS_ACCOUNTS
  maskedNumber?: string;
  role: 'transaction' | 'savings' | 'offset' | 'credit' | 'loan' | 'investment' | 'super';
  source: { kind: 'cdr-file' | 'synthetic' | 'manual'; fileHash?: string };
}

interface Txn {
  id: string;                 // CDR transactionId, or stable hash if absent (FR-ING-004)
  accountId: string;
  status: 'PENDING' | 'POSTED';
  cdrType: string;            // CDR type enum, kept verbatim
  postedAt?: string;          // ISO 8601
  valueAt?: string;
  executedAt?: string;
  amount: Money;              // negative = outgoing, as in CDR
  description: string;
  reference?: string;
  merchantName?: string;
  mcc?: string;               // merchantCategoryCode
  billerCode?: string; billerName?: string;
  // derived
  classification?: Classification;
  transferPairId?: string;    // links the two legs of an internal transfer
}

interface Classification {
  kind: 'income' | 'opex' | 'capex' | 'transfer' | 'investment' | 'tax' | 'fee' | 'interest' | 'refund';
  categoryId: string;         // BudgetCategory.id
  assetId?: string;           // when kind = 'capex'
  confidence: number;         // 0..1
  by: 'rule' | 'memory' | 'model' | 'llm' | 'user';
  ruleId?: string; modelVersion?: string;
}

interface BudgetCategory { id: string; name: string; parentId?: string; kind: Classification['kind']; }

interface BudgetLine {                        // one row of an OPEX budget
  id: string; categoryId: string; item: string;
  cost: Money;
  period: Period;                             // 'd','w','f','m','q','y','2y','3y','5y','6y','visit', …
  tierMultiplier: Record<TierId, number>;     // e.g. { secure: 1, independent: 1.5, luxury: 2 }
  startDate?: string; renewDate?: string; notes?: string; url?: string;
}

type TierId = 'secure' | 'independent' | 'luxury' | string;
interface Tier { id: TierId; name: string; description: string; }

interface Asset {                             // CAPEX register entry
  id: string; name: string; categoryId: string;
  purchasedAt?: string; cost: Money;
  forecastCost?: Money;                       // planned, before purchase
  life: { meanYears: number; shape?: number };// Weibull: shape k, scale from mean
  replace: boolean;                           // replace at end of life?
  replacementCostGrowth?: number;             // real growth per year beyond inflation
  status: 'wish' | 'planned' | 'owned' | 'retired';
  tier?: TierId;                              // the lowest tier that includes this item
  linkedTxnIds: string[]; url?: string;
}

interface Holding {                           // capital, for the freedom model
  id: string; name: string;
  assetClass: 'cash' | 'term_deposit' | 'equity' | 'property' | 'btc' | 'super' | 'other';
  value: Money; costBase?: Money; acquiredAt?: string;
  returnModelId: string;                      // §10.3
  accessibleFrom?: string;                    // e.g. super preservation age
}

interface Goal {
  id: string; name: string; tier: TierId;
  start: string;                              // date passive living begins
  horizonYears: number;                       // or until age N
  floor: Money;                               // real capital never below this
  targetProbability: number;                  // e.g. 0.9
  projectIncome?: Money;                      // optional income from chosen work, per year
  constraints?: Record<string, unknown>;
}

interface Scenario {
  id: string; name: string; seed: string;
  tier: TierId; goalId: string;
  decisions: Record<string, number | string | boolean>;   // §11.3
  assumptions: Assumption[];
}

interface Assumption { key: string; value: number | string; unit?: string; source: string; provenance: Provenance; }

interface RunRecord {
  id: string; scenarioId: string; seed: string;
  gssk: { version: string; sha256: string };
  modelHash: string; inputsHash: string;
  startedAt: string; ms: number;
  summary: Record<string, number>;            // e.g. pSuccess, medianEndCapital
  outputsRef: string;                         // OPFS path to quantile arrays
}
```

---

## 6. Ingest

### 6.1 CDR Open Banking format (primary, FR-ING-001)

The app ingests the **Australian Consumer Data Right (CDR) Banking API** response payloads, as
defined by the Consumer Data Standards (consumerdatastandards.gov.au). The implemented standards
version is pinned in `src/ingest/cdr/VERSION`, currently **v1.36.0**. The JSON Schemas in
`schemas/cdr/` are derived from that release's OpenAPI document by `scripts/cdr-schemas.ts`
(ADR 0008).

Accepted files (JSON, one response body per file, or a ZIP of them):

| Endpoint shape | Used for |
|---|---|
| `GET /banking/accounts` → `data.accounts[]` (`BankingAccount`) | Account list and roles |
| `GET /banking/accounts/balances` → `data.balances[]` (`BankingBalance`) | Balance checkpoints for reconciliation and calibration (§9.4). `BankingBalance` has no observation time, so the app reads an optional top-level `x-as-at` (ISO 8601 with offset). Without it, the file's modification time is used and the checkpoint is labelled `assumed` (ADR 0008). |
| `GET /banking/accounts/{id}/transactions` → `data.transactions[]` (`BankingTransaction`) | Transactions |

Each response carries `links` (`self`, `first`, `prev`, `next`, `last`) and `meta` (`totalRecords`,
`totalPages`). The importer accepts any subset of pages, in any order. Files that are not CDR
banking responses (for example budget CSVs, `truth.json`, `manifest.json`) are skipped and
reported, not rejected.

`BankingTransaction` fields consumed: `accountId`, `transactionId`, `isDetailAvailable`, `type`
(`FEE`, `INTEREST_CHARGED`, `INTEREST_PAID`, `TRANSFER_OUTGOING`, `TRANSFER_INCOMING`, `PAYMENT`,
`DIRECT_DEBIT`, `OTHER`), `status` (`PENDING`, `POSTED`), `description`, `postingDateTime`,
`valueDateTime`, `executionDateTime`, `amount` (string decimal, negative = outgoing), `currency`
(defaults to AUD), `reference`, `merchantName`, `merchantCategoryCode`, `billerCode`, `billerName`,
`crn`, `apcaNumber`.

| ID | Requirement |
|---|---|
| FR-ING-002 | Validate every file against a JSON Schema derived from the pinned standard. Reject the file (not the batch) with a message naming the first failing path. Unknown extra fields are kept in `raw`, not rejected. |
| FR-ING-003 | Parse `amount` as a decimal string to integer minor units. Never through a binary float. |
| FR-ING-004 | Deduplicate by `(accountId, transactionId)`. When `transactionId` is absent, use a stable hash of `(accountId, postingDateTime or executionDateTime, amount, description)` and flag the record `idSynthetic`. |
| FR-ING-005 | A `POSTED` record supersedes a matching `PENDING` record (same account, same amount, description similarity ≥ threshold, within 7 days). Superseded pendings are kept, hidden. |
| FR-ING-006 | Re-importing the same file is a no-op. Each import is recorded with its file SHA-256, counts (new/dup/superseded/rejected) and can be undone as a unit. |
| FR-ING-007 | Detect internal transfers: an outgoing and an incoming leg across the user's own accounts, equal and opposite amounts, within 3 days. Link them (`transferPairId`) and exclude both from spend. |
| FR-ING-008 | Times are stored as given (with offset) and bucketed to local dates in the user's configured timezone (default `Australia/Sydney`). |

### 6.2 Workbook import (FR-ING-010)

Import an existing budget workbook as **CSV**: one CSV file per sheet, exported by the user from
their spreadsheet program. The app does not read `.xlsx` (ADR 0003). Import goes through a
**mapping wizard**, not a hard-coded layout. Built-in presets recognise the common layout:

| Sheet (CSV file) type | Recognised columns | Maps to |
|---|---|---|
| OPEX budget | Category (section header rows), Item, Cost, Unit (period code), Start Date, Renew Date, tier multipliers (e.g. *Fin. Secure / Fin. Indepnt / Fin. Luxury*), Sub-category, Notes | `BudgetCategory`, `BudgetLine`, `Tier` |
| CAPEX register | Source Year, Item, Forecast Spend, Paid?, Date Paid, Actual Spend, Expected Life, Replacement Year, Product URL | `Asset` |
| Yearly wish-list | Item, Link, Config, Toggle, Price, Forecast Spend, Date Paid, Actual Spend | `Asset` with status `wish`/`planned`/`owned` |
| Renewals | Item, Date, Cost | `Asset.purchasedAt` updates |
| Goal / retirement sheet | Starting balance, budget need, return, inflation, tax rate, CGT discount, years | `Goal`, `Assumption` |

| ID | Requirement |
|---|---|
| FR-ING-011 | Parse CSV as RFC 4180 text (quoted fields, embedded commas and newlines, UTF-8 with or without BOM). Values are taken as given, so no formula is ever evaluated. Report cells holding a spreadsheet error literal (`#DIV/0!`, `#REF!`, `#VALUE!`, `#N/A`) and skip them. |
| FR-ING-012 | Period codes are mapped through a user-editable table (`d`, `w`, `f`, `m`, `q`, `h`, `y`, `Ny` = every N years, `Nv` = N visits a year, `v` = once a year), with the per-week normaliser shown, so imported per-week figures can be checked against the sheet's own. |
| FR-ING-013 | Every imported record keeps `source: { file, row }` so a value can be traced back to its row in the exported CSV. |
| FR-ING-014 | The import is previewed (counts, totals per tier per week) before commit. The totals SHOULD match the CSV's own totals row within 0.5 %. A mismatch is shown, not hidden. |
| FR-ING-015 | **Mapping spec.** Every way of proposing a mapping (presets, the learned mapper, the LLM assistant) produces the same JSON *mapping spec*: column → field and parse rule, row roles (header, section, line, totals) and the period vocabulary. It is validated against `schemas/mapping-spec.schema.json`. Deterministic code applies it, and the user confirms it in the preview. A proposer never writes a figure (NFR-HON-002). ADR 0014. |
| FR-ING-016 | **Learned mapper (M10).** A small in-browser model in ml-core classifies column and row roles from header tokens, value statistics and position. It is trained on synthetic budgets in many layouts and adapts to the user's own wizard corrections, kept locally. Gate: ≥ 95 % column accuracy on held-out synthetic layouts. |
| FR-ING-017 | **LLM mapping assistant (M8, optional).** For layouts the first two tiers leave uncertain, an LLM proposes a mapping spec from the header rows and a few sampled rows, redacted with amounts bucketed (FR-API-003). It uses structured outputs: the Claude API's `output_config.format` with the JSON Schema or a `strict: true` tool, or `json_schema` response format on OpenAI-compatible providers. The response is re-validated locally. Consent and logging follow §13.1. |
| FR-ING-018 | The wizard shows who suggested each column (rules, model or LLM) and their confidence. Every suggestion is editable. |

### 6.3 Later formats (not v1)

Bank transaction CSV adapters (column-mapping presets per bank), OFX/QFX, QIF. Each adapter converts to the canonical
`Txn` and is held to the same FR-ING-002…008.

---

### 6.4 Live bank connections (M11, production; not v1)

Fetching transactions directly from banks would remove the manual export step. Constraints:

- **Accreditation.** Under the CDR, only an accredited data recipient can call the banking APIs,
  or a business operating under a sponsorship or CDR-representative arrangement with one. A
  consumer cannot call them directly.
- **Secrets.** OAuth client credentials, refresh tokens and mutual-TLS keys cannot live in a static
  browser app (§1.1, NFR-PRIV-001).

Design, so the rest of the app is unchanged:

| ID | Requirement |
|---|---|
| FR-LIVE-001 | A **connector** is a separately deployed, optional component. It is operated by the user, or by an accredited partner under a sponsor or representative arrangement. It completes the CDR consent flow and fetches the user's data. The static app never holds bank credentials or CDR tokens. |
| FR-LIVE-002 | The connector returns the **same CDR response JSON** that file import accepts (§6.1). The browser imports it through the existing pipeline (FR-ING-001…008), with its validation, dedupe and reconciliation. |
| FR-LIVE-003 | Fetched data is stored only in the browser (NFR-PRIV-001). The connector keeps nothing beyond what consent management requires, and says what that is. |
| FR-LIVE-004 | Each sync is an egress call under §13 (FR-API-001…005): the connector origin is configured in Settings and added to the CSP `connect-src`, and each sync is confirmed and logged. |
| FR-LIVE-005 | Consent is visible and revocable from Settings: accounts shared, scopes, expiry, last sync. Revoking deletes the connector's stored tokens. |
| FR-LIVE-006 | Bank-specific personal APIs (a personal access token for one bank) MAY be supported as connector plugins, subject to the bank's terms and to CORS. A token entered by the user is held like an API key (FR-API-001). |

### 6.5 Receipts (M13; iOS companion app, separate repository)

Receipts add line items to bank transactions: split categories, model, serial and warranty for
assets, and refund matching. ADR 0017.

| ID | Requirement |
|---|---|
| FR-RCPT-001 | A SwiftUI iOS app (repository `budget-app-receipts`) captures receipts with VisionKit and recognises text on the device with the Vision framework. Images and text stay on the phone by default. An optional LLM fallback follows §13.1 and is labelled when used. |
| FR-RCPT-002 | Receipts follow the versioned contract `schemas/receipt.schema.json`: merchant, ABN, datetime, currency, total, tax, payment hint, and line items with OCR confidence. Fixtures carry `x-synthetic`. |
| FR-RCPT-003 | The lines must sum to the total within rounding, or the receipt is flagged for review. |
| FR-RCPT-004 | Receipts reach the web app through the user's sync storage (§14.1), as an imported `.receipt.json`, or by a local handoff. There is no server of ours in the path. |
| FR-RCPT-005 | Reconciliation matches a receipt to a bank transaction by amount (exact, or within a tip or surcharge tolerance), date (±3 days) and merchant similarity. Matches attach line items and can split the category by line. Unmatched receipts wait in a review queue. |
| FR-RCPT-006 | Capital line items create or link register assets, with purchase date, cost, model, serial and warranty end. |
| FR-RCPT-007 | The synth generator emits receipts for its purchases, so reconciliation is tested end to end on synthetic data. |

---

## 7. Synthetic data (FR-SYN)

The app MUST be fully usable, and fully tested, on synthetic data before any real data exists.

### 7.1 Generator

A seeded generator produces a synthetic household as CDR-conformant response files plus a
ground-truth file. It runs in a worker (in-app "Try with synthetic data") and from the CLI
(`npm run synth -- --persona personas/default.json --seed 42 --months 24 --out fixtures/syn-42/`).

Outputs:

```
fixtures/syn-42/
  accounts.json                       # CDR BankingAccount list
  balances/<date>.json                # CDR BankingBalance snapshot, one per month end, with x-as-at
  transactions/<accountId>/page-N.json # CDR BankingTransaction pages, with links/meta
  truth.json                          # per transactionId: kind, categoryId, assetId, transferPairId
  workbook/<sheet>.csv                # matching synthetic budget workbook: opex-budget, capex-register, goal (§6.2)
  manifest.json                       # generator version, persona hash, seed, x-synthetic: true
```

Every synthetic JSON file carries a top-level `"x-synthetic": { "generator": "...", "seed": "..." }` key,
and every synthetic CSV starts with a `# x-synthetic: generator=..., seed=...` line. The importer
ignores both. The CI data-hygiene check requires them (§16.4). Account IDs begin `SYN-`,
masked numbers end `SYN`, and merchant names come from a fictional list.

### 7.2 Persona (config)

```jsonc
{
  "timezone": "Australia/Sydney",
  "start": "2024-07-01", "months": 24,
  "accounts": [
    { "id": "SYN-TXN", "role": "transaction", "productCategory": "TRANS_AND_SAVINGS_ACCOUNTS", "opening": "4200.00" },
    { "id": "SYN-SAV", "role": "savings",     "productCategory": "TRANS_AND_SAVINGS_ACCOUNTS", "opening": "25000.00", "interestPa": 0.045 },
    { "id": "SYN-CC",  "role": "credit",      "productCategory": "CRED_AND_CHRG_CARDS", "limit": "8000.00" }
  ],
  "income": [ { "name": "Salary", "amount": "3100.00", "every": "fortnight", "jitter": 0.0, "rises": [{ "on": "2025-07-01", "pct": 0.03 }] } ],
  "recurring": [
    { "category": "housing.rent",      "amount": "620.00", "every": "week",    "via": "DIRECT_DEBIT" },
    { "category": "utilities.electricity", "mean": "380.00", "every": "quarter", "seasonality": "winter_peak", "cv": 0.15 },
    { "category": "comms.mobile",      "amount": "65.00",  "every": "month" },
    { "category": "health.insurance",  "amount": "160.00", "every": "month" }
  ],
  "variable": [
    { "category": "food.groceries", "weeklyMean": "140.00", "cv": 0.25, "visitsPerWeek": 2.5, "merchants": ["Fresh Fields", "Corner Grocer"] },
    { "category": "food.cafe",      "dailyProb": 0.6, "amount": { "lognormal": [1.6, 0.3] } }
  ],
  "capex": [
    { "asset": "Laptop",         "cost": "3200.00", "lifeYears": 5, "shape": 3, "lastBought": "2021-03-01" },
    { "asset": "Watch",          "cost": "900.00",  "lifeYears": 10, "wish": true, "buyProbPerYear": 0.3 },
    { "asset": "Fountain pen",   "cost": "180.00",  "lifeYears": 8 },
    { "asset": "Holiday (international)", "cost": { "normal": [6000, 1500] }, "every": "year", "month": [1, 7] }
  ],
  "investing": [ { "to": "SYN-BROKER", "amount": "500.00", "every": "month", "kind": "investment" } ],
  "noise": {
    "pendingThenPosted": 0.15,       // share of card txns first emitted PENDING
    "duplicatePages": 0.02,          // overlapping page exports
    "merchantNameVariants": true,    // "FRESH FIELDS 0231 SYDNEY", "Fresh Fields Pty"
    "refunds": 0.01, "fees": true, "missingTransactionId": 0.01
  }
}
```

| ID | Requirement |
|---|---|
| FR-SYN-001 | Same persona + same seed ⇒ byte-identical output (NFR-DET-001). The PRNG is SplitMix64 (same algorithm as GSSK's instance RNG), seeded from the decimal or hex seed string. |
| FR-SYN-002 | Output validates against the same CDR schemas as real imports (FR-ING-002). |
| FR-SYN-003 | Balances are consistent: opening + Σ posted amounts = each emitted balance, to the cent. |
| FR-SYN-004 | `truth.json` labels every transaction. It is never read by the app at runtime; it is read only by tests and the evaluation page (§16.2). |
| FR-SYN-005 | CAPEX purchases are drawn from each asset's Weibull life from `lastBought`, so the replacement forecaster (§10.2) can be evaluated against known truth. |
| FR-SYN-006 | Ship three committed personas: `frugal-renter`, `default` (mixed), `high-capex-crypto` (heavy lumpy spend and BTC transfers). |

---

## 8. Classification

Pipeline, first confident answer wins. Each stage records `by` and `confidence`.

1. **Structural** — CDR `type` alone: `INTEREST_PAID` → interest, `FEE` → fee, transfer pairs (FR-ING-007).
2. **User rules** — ordered, editable: match on `merchantName`, `description` regex, `billerCode`,
   `mcc`, amount range, account. Rule hits are `confidence = 1`.
3. **Merchant memory** — every user correction applied to similar transactions stores
   `normalisedMerchant → category`, per direction (money in or out). Normalisation strips store
   numbers, card prefixes, company suffixes, leading payment-method words, and case. Recall takes
   the longest remembered prefix of the payee's tokens, so suburb suffixes don't matter. Applies
   with `confidence = 0.95` (ADR 0009).
4. **MCC map** — `merchantCategoryCode` → default category table (shipped, editable). An entry can
   route purchases above a set amount to a capital category. Confidence 0.8.
5. **In-browser model** — a small text classifier over normalised description + merchant + amount
   bucket + weekday + MCC. v1: multinomial naive Bayes on hashed word and character-trigram
   features, trained in the ingest worker on the user's own corrected transactions once there
   are at least two categories and five labels. Retrained from the stored labels on load rather
   than persisted as weights (ADR 0009). Optional later: a small sentence-embedding model for k-NN.
6. **LLM (optional, §13)** — only for transactions still below the confidence threshold, only with
   consent, only redacted fields.
7. **Unclassified** — shown in a review queue.

| ID | Requirement |
|---|---|
| FR-CLS-001 | Correcting one transaction offers "apply to N similar" and creates a memory entry or a rule. |
| FR-CLS-002 | **CAPEX detection**: a debit is proposed as CAPEX when its category is configured as capital, or when its amount exceeds a per-category threshold (default: 4× the category's median, and ≥ AUD 200). The user confirms, and links it to an existing `Asset` or creates one (life pre-filled from the category default). |
| FR-CLS-003 | Refunds are linked to their original purchase when amounts match within 60 days, and net against it. |
| FR-CLS-004 | Re-running classification never overwrites `by: 'user'`. |
| FR-CLS-005 | On synthetic `default` persona, after 50 user corrections the pipeline reaches ≥ 95 % category accuracy and ≥ 98 % kind accuracy against `truth.json` (measured in CI, §16.2). |

---

## 9. Budget, actuals and CAPEX register

### 9.1 Budget

- Budget lines are normalised to a common rate (per week, per month, per year) through the period
  table (FR-ING-012).
- **Tiers** multiply each line: tier total = Σ line rate × `tierMultiplier[tier]`. Lines with
  multiplier 0 are excluded from that tier. Tiers are user-defined (default three: *Secure*,
  *Independent*, *Luxury*).

### 9.2 Actual vs budget (FR-BUD-001)

For a chosen period and tier: per category, budget, actual (posted, excluding transfers), variance,
variance %, and a trailing 3/6/12-month run rate. Drill down to transactions.

### 9.3 CAPEX register (FR-CAP)

| ID | Requirement |
|---|---|
| FR-CAP-001 | Each asset shows age, expected remaining life (Weibull conditional on age), next replacement date distribution (P10/P50/P90) and replacement cost in nominal and real terms. |
| FR-CAP-002 | **Sinking fund view**: the weekly amount that, set aside from today, funds all expected replacements over the horizon. This is the CAPEX line the budget was missing. Expected replacements come from a seeded Monte-Carlo renewal process per asset; at a zero real rate the fund is their real total divided by the horizon's weeks (ADR 0010). |
| FR-CAP-003 | **Annualised CAPEX** per tier = Σ (replacement cost / life) over assets included in the tier, shown alongside OPEX so the budget total is OPEX + annualised CAPEX. |
| FR-CAP-004 | Wish-list items carry a decision (`buy by date`, `defer`, `drop`). Scenarios can toggle them (§11.3). |
| FR-CAP-005 | Assets imported from the workbook with no `Expected Life` get a category default and are flagged `assumed`. |

### 9.4 Reconciliation (FR-REC-001)

For each account with balance checkpoints: simulated balance (opening + classified flows) vs reported
balance. A drift above AUD 1 is an import gap (missing pages) and is reported with the date range.

---

## 10. Forecasting

All forecasting runs in a worker on `ml-core` (§15.2). Every forecast is a set of **quantile paths**
(P5, P10, P25, P50, P75, P90, P95) per series, plus the method and backtest score that produced it.

### 10.1 OPEX per category (FR-FC-001)

Monthly series per category from actuals; when history is shorter than 6 months, fall back to the
budget line (labelled `budgeted`).

Candidate methods, chosen per series by rolling-origin backtest (MASE, plus pinball loss for
quantiles):

| Method | For |
|---|---|
| Seasonal naive / budget | baseline, always computed |
| ETS (Holt-Winters, additive, damped trend) | regular series; the seasonal component needs ≥ 3 full seasons, else Holt damped (ADR 0011) |
| Historical mean | flat, noisy series |
| Croston / SBA / TSB | intermittent series (many zero months) |
| Empirical residual bootstrap | quantiles for any of the above |

Inflation: forecasts are produced in real terms and inflated by a CPI assumption (`assumed`, editable,
default from the user's settings). An optional API MAY fetch published CPI (§13); in M8 CPI is a manual assumption.

The method set is extensible: an ONNX time-series model (for example a small pretrained forecaster)
MAY be added later as one more candidate. It MUST win the backtest on the user's own data to be used.

### 10.2 CAPEX (FR-FC-010)

For each asset with `replace = true`: replacement time ~ Weibull(shape k, scale from mean life),
conditional on current age; cost grows by inflation + `replacementCostGrowth`. Wish-list items
contribute according to their decision or `buyProbPerYear`. Monte-Carlo over assets gives quantile
paths of CAPEX spend per month.

### 10.3 Returns, prices and FX (FR-FC-020)

Each `Holding.returnModelId` refers to one of:

| Model | Parameters | Notes |
|---|---|---|
| `fixed` | annual real return | Deterministic. Reproduces a single-number spreadsheet. |
| `lognormal` | μ, σ (annual) | Monthly draws. |
| `student-t` | μ, σ, ν | Fat tails. |
| `block-bootstrap` | history series, block length (default 12 months) | Resamples the user-supplied or API-fetched monthly return history. Preserves volatility clustering. Default for BTC and equities. |
| `regime` | two-state Markov switching (bull/bear) | MAY, later. |

Return paths for different holdings are drawn jointly (same bootstrap months) to keep correlation.
Price history files are user-imported CSV (Settings, M8), or MAY later be fetched with consent (§13). None is committed except
synthetic series.

### 10.4 Bayesian workflow (M9, FR-BAY)

Forecasts are built, checked and compared following the Bayesian workflow (Gelman, Vehtari et al.,
*Bayesian Workflow*). The aim is calibrated uncertainty, because pSuccess is only as honest as its
inputs. ADR 0015 proposed it; ADR 0022 records what was built and why it differs, with the lab notes
in `docs/reports/`.

| ID | Requirement |
|---|---|
| FR-BAY-001 | A Bayesian structural time-series model of a household's categories (local level, seasonal effects with ≥ 24 months, log scale), with a hurdle for categories with zero months. Fixed bills are left out. It supplies the **total** spending paths the simulation uses; category charts keep their §10.1 method (ADR 0022). |
| FR-BAY-002 | Partial pooling across a household's categories through shared hyper-priors. Weakly informative priors, checked (and once revised) by the prior predictive check. |
| FR-BAY-003 | A shared latent household spending factor (AR(1)) with **one common loading** moves every category together, so totals carry cross-category correlation. Per-category loadings and full multi-construct SEM are out of scope (not identifiable from one household's data). |
| FR-BAY-004 | Return-parameter uncertainty: Normal–Inverse-Gamma posteriors for each return model's monthly log-return mean and variance (assumed values count as 30 years of evidence; histories as their own length). Each Monte-Carlo run draws its parameters first (FR-FC-020). On by default; a switch on the Freedom screen. |
| FR-BAY-005 | Inference: collapsed Metropolis on the Kalman-filter likelihood for variances, the factor's loading and persistence, with paths by forward-filtering backward-sampling. The FFBS and Kalman kernels are in ml-core with TypeScript twins and parity tests. Seeded (NFR-DET-001). |
| FR-BAY-006 | Diagnostics per fit: split-R̂ ≤ 1.05 and effective sample size ≥ 100, with one longer retry. A failing fit falls back to the §10.1 forecaster, labelled as such. |
| FR-BAY-007 | The Forecast screen's model panel shows the diagnostics, holdout calibration (randomised PIT on held-out months), prior sensitivity and a prior predictive check. CI gates: on the synthetic personas every fit converges, every prior predictive check passes, and pooled P10–P90 holdout coverage is 70–95 %. |
| FR-BAY-008 | Simulation-based calibration of the sampler in CI (λ, φ, σ, τ). Prior sensitivity (power-scaling ×0.5, ×2) of next year's spending is shown in the model panel; prior sensitivity of pSuccess is deferred. |

---

## 11. Freedom model (goals, simulation, optimisation)

### 11.1 The GSSK model (FR-SIM-001, generated by `modelgen`)

`modelgen` is a pure function `(state, scenario) → GSSK model JSON`. Time unit: **months**, `t = 0` at
scenario start, `dt = 1`, fixed-step RK4 (or Euler; all flows are piecewise constant per month).
Carrier: `money` (`AUD`, `conserved: true`). Non-AUD holdings are valued in AUD inside the model;
FX enters through their return paths.

The model is **closed** (ADR 0012): every node is a `storage`, so nothing enters or leaves the
`money` carrier and the kernel's own conservation applies.

| Element | GSSK construct |
|---|---|
| External pools: `income` (wages, project income), `market` (investment gains) | `storage`, opened at 1e10 so they never reach zero (GSSK clamps a storage at zero, which would create money) |
| Bank (transaction + offset, aggregated) | `storage` |
| Each holding (cash, shares, BTC, super, property equity) | `storage` |
| Sinks: `opex`, `capex`, `tax`, `market_loss` | `storage`, opened at 0; Q reads as the cumulative amount |
| Pay, project income | `income` → `bank` |
| OPEX (all groups together; KR-7), CAPEX, tax | `bank` → sink |
| Returns | per holding, `market` → holding (gain) and holding → `market_loss` (loss) |
| Contributions, withdrawals | per holding, `bank` → holding and holding → `bank` |

Every edge is `constant`. The controller sets each k monthly to the amount in dollars, so with
`dt = 1` a month's flow is exactly k. Gains and losses are separate edges, so no rate is ever
negative (KR-3). Returns are discrete monthly amounts (gain k = holding × max(r, 0)), which
compounds exactly like a spreadsheet (FR-SIM-006).

OPEX is one sink, not one per category group. GSSK 5.3.0 scans the graph for motifs after every
step, at a cost that grows with the bank's edges (KR-7), and per-group spending is not a
simulation output.

### 11.2 Policy controller and Monte-Carlo runner (FR-SIM-002)

The kernel integrates; the app decides. Each month the controller, in the `sim` worker:

1. reads state (`GSSK_GetState`);
2. sets this month's return edges from the run's sampled path (`GSSK_SetEdgeK`);
3. applies the scenario's **withdrawal strategy** (below) by setting drawdown edge rates;
4. computes tax for the financial year to date (ATO brackets, Medicare levy, CGT with discount for
   assets held ≥ 12 months, using cost base tracked per holding) and sets the tax edge;
5. records `GSSK_SetMutationCause(inst, "policy:<rule>")` before each change, so the mutation log
   explains every rate change;
6. steps one month (`GSSK_Step`).

Withdrawal strategies (scenario decision):

| ID | Strategy |
|---|---|
| `fixed-real` | withdraw the tier's annual need, inflated; sell holdings in a configured order |
| `percent` | withdraw x % of capital each year |
| `guardrails` | Guyton-Klinger style: cut/raise spending when withdrawal rate leaves a band |
| `skim` | withdraw only realised returns above a threshold; leave principal |
| `hold` | no sales from a holding (e.g. BTC); live from other holdings and income |

**Monte-Carlo:** for `N` runs (default 1000; configurable), one `GSSK_Init` per scenario, then
`GSSK_Reset` per run. Run `i` uses seed `hash(scenario.seed, i)` for every sampled input (OPEX
quantile draw, CAPEX events, return path). Per run the runner keeps a small summary (end capital,
min real capital, ruin month, total tax) and streams per-month values into quantile accumulators
(P5…P95) per tracked node. It does not keep all paths. The first 20 runs are kept whole for display
as example paths.

Tax tables live in `data-tables/tax/au-<year>.json` with a source URL and a `verifiedBy`/`verifiedOn` field.
The app warns when the scenario runs past the last verified year (later years reuse the last table,
labelled `assumed`).

| ID | Requirement |
|---|---|
| FR-SIM-003 | **Money balance**, checked at every step of every run. The change in money held by the household and the sinks equals what the pool edges paid in, within 1e-9 relative to household money (bank plus holdings, at least $1). Each pool must also have paid out exactly that amount. Otherwise the run is marked invalid, shown as such, and excluded from pSuccess. The model is closed (§11.1), so this is a check on the integrator, not on boundary flows (ADR 0005, ADR 0012). |
| FR-SIM-004 | Every run stores its GSSK version, wasm SHA-256, model hash, inputs hash and seed. Any run can be replayed exactly from those (`GSSK_Replay` with the exported mutation log, or re-execution). |
| FR-SIM-005 | 1000 runs × 40 years (480 steps) of the default model complete in ≤ 10 s on a 2022 mid-range laptop, using `navigator.hardwareConcurrency − 1` workers. |
| FR-SIM-006 | A `fixed` return model with one run reproduces a single-path spreadsheet projection (same inputs) to within AUD 1 per year. This is the bridge test from the user's existing workbook. |

### 11.3 Goals and metrics (FR-GOAL)

Inputs: `Goal` + `Scenario.decisions`. Decision variables (each optional):

`savingsRate`, `tier`, `freedomStartDate`, `allocation` (weights per holding class),
`withdrawalStrategy` (+ params), `capexDecisions` (per wish-list asset: buy/defer/drop),
`housing` (rent / buy at date with price, deposit, loan), `projectIncome`, `workUntil`.

Outputs per scenario:

| Metric | Definition |
|---|---|
| **pSuccess** | share of runs where real capital ≥ `floor` at every month from `start` to horizon, and the tier's spending was always met |
| **Freedom number** (deterministic) | capital needed at `start` for the tier's annual need (OPEX + annualised CAPEX), grossed up for tax, at the user's chosen withdrawal rate. Matches the spreadsheet definition, labelled `assumed` |
| **Freedom number (P90)** | smallest starting capital with pSuccess ≥ 0.9, by bisection over the simulator |
| **Years to freedom** | P50 / P10 / P90 months until capital first meets the P90 freedom number, under the current savings rate |
| **Project runway** | months of fully funded project work available now, at the chosen tier |
| **Shortfall drivers** | variance attribution: re-run with each stochastic input frozen at its median and report the change in pSuccess |

### 11.4 Optimiser (FR-OPT-001)

"What would make this 90 % likely?" The optimiser searches the levers the user unlocks, inside the
bounds they set:

| Lever | Unit |
|---|---|
| When freedom starts (paid work moves with it) | years later or sooner |
| Spending after freedom | multiplier on the tier |
| Spending now | multiplier on today's spending |
| Project income | dollars a year |

It finds:

- the **minimum change** achieving pSuccess ≥ target: the Euclidean distance from the current
  setup, each lever normalised to its bounds;
- a **Pareto set** over pSuccess, spending after freedom and freedom start, for display.

Method:

- Up to two levers: a coarse grid, then a finer grid around the best point.
- More than two: CMA-ES in `ml-core`, with a TypeScript twin and a parity test.
- Every candidate uses common random numbers: the same seed and run indices.
- The search stops at a simulation budget the user chooses.

Results are scenarios the user can keep, open and compare (up to four side by side, decisions that
differ highlighted). Every result cites its runs (inputs hash, seed, run range). ADR 0013.

---

## 12. User interface

Plain, fast, keyboard-friendly. Light and dark themes. Colour-blind-safe series palette. Every chart
labels provenance (NFR-HON-001) and shows quantile bands, not single lines, wherever a value is
uncertain.

| Screen | Contents |
|---|---|
| **Start** | Landing page: what Crux does in plain words, how it works in four steps, "Try it with a sample household" or "Use my own data", the privacy promise. When data exists, "Welcome back" with the next step. A getting-started guide under the menu walks through the screens in order (ADR 0020). |
| **Import** | Drop zone for CDR JSON/ZIP and budget CSV files. Per-file results (FR-ING-006). Mapping wizard for CSV sheets. Undo import. |
| **Transactions** (route `/ledger`) | Transactions table: filter, search, bulk re-categorise, review queue, CAPEX proposals, transfer pairs. |
| **Budget** | Lines by category with tier columns; actual vs budget; run-rate; period switch (wk/mth/yr). |
| **Big purchases** (route `/capex`; the CAPEX register) | Asset register; replacement timeline (P10–P90 bars); sinking fund; wish-list decisions. |
| **Forecast** | Per-category fan charts; method and backtest score per series; CAPEX fan; totals. |
| **Freedom** | Goal editor; pSuccess gauge per tier; capital fan chart in real terms with floor line; example paths; years to freedom; project runway; shortfall drivers. |
| **Scenarios** | Side-by-side comparison (up to 4); optimiser; diff of decisions. |
| **Chat panel** (was Advisor) | Docked on the right of every screen, open by default on wide screens, a sheet on phones. Common questions and requests are answered on the device from the app's own results; others go to the optional AI provider (§13). Every reply says which. Changes are proposed as cards to Apply or Undo. ADR 0023. |
| **Engine check** (route `/kernel`; linked from Settings and Start, not in the menu) | Pinned GSSK version, commit and SHA-256 verification status. Runs GSSK's household example model in the `sim` worker as a smoke test (M0). |
| **Settings** | Timezone, currency, CPI, period table, categories, rules, tax tables, return models, API providers and keys, encryption, export/import, delete all data. |

---

## 13. External APIs and the advisor (optional)

All of this is **off by default**. The app is complete without it.

### 13.1 Egress rules (NFR-PRIV-003)

| ID | Requirement |
|---|---|
| FR-API-001 | Providers are configured in Settings (endpoint, model, key). **Keys are never stored on the device**: they are held in memory for the session, never written to storage or exports, forgotten on reload or lock, and sent only to their own endpoint (ADR 0021). |
| FR-API-002 | Before each call, show the exact payload to be sent; the user confirms. "Don't ask again until the app reloads" MAY be offered per provider and purpose. |
| FR-API-003 | **Redaction by default.** Payloads never contain account IDs, masked numbers, BSB/account numbers, names of people, addresses or exact balances. Amounts are bucketed or rounded. |
| FR-API-004 | Every call is logged locally (time, provider, purpose, origin, payload hash, bytes sent, status) and shown in Settings. |
| FR-API-005 | A Content Security Policy restricts `connect-src` to the app origin plus a static list of provider origins, the same list the egress gate enforces (ADR 0021). |

### 13.2 Uses

| Use | Provider type | What is sent |
|---|---|---|
| Map an unusual budget CSV (FR-ING-017) | LLM API with structured outputs | header rows + a few sampled rows, amounts bucketed; returns a mapping spec, never figures |
| Classify leftover transactions (§8 stage 6) | LLM API, or in-browser LLM | normalised merchant + description + amount bucket + candidate categories |
| Market history (BTC, indices, FX) | none in M8: the user imports a price-history CSV (ADR 0021); a price API MAY be added later | ticker symbols and date range only |
| CPI | none in M8: a manual assumption; a statistics API MAY be added later | series ID only |
| **Advisor** | LLM API; an in-browser LLM (WebLLM/WebGPU) MAY be added later | the user's question, the scenario's decision variables, aggregate metrics, assumption list — never transactions unless the user attaches them |

### 13.3 Advisor contract (NFR-HON-002)

The advisor is the chat panel (ADR 0023). Common questions and requests are answered by the app
itself from its own results and templated text, with no AI; anything else goes to the AI provider,
a tool-using agent with a fixed tool set that cannot compute figures itself. Each reply is labelled
`Crux` or `Crux + <provider>`, and AI answers are cached for the session by question, screen and
data. Changes are proposed as cards (budget lines, big purchases, category changes, scenarios) that
the person applies, and can undo. AI replies stream as they are written, and an activity log shows
each step as it happens: what ran on the device, what was sent to the AI and how big it was, and
the AI's own notes (ADR 0024). Plan checks find settings that make a plan fail in a way the person
likely didn't mean (no pay before freedom, a large bank buffer that earns nothing, and others) and
offer fixes as cards; the AI calls `check_plan` first when a plan looks surprisingly bad (ADR 0026).

Tools exposed to the model (M8, ADR 0021; ADR 0023): `get_plan`, `get_spending_summary`,
`list_scenarios`, `run_plan(scenarioId)` (returns run ID + metrics), `propose_plan(changes)`,
`explain_assumption(key)`, `explain_shortfall`, `find_plan_changes`, `get_forecast_confidence`,
`propose_budget_line`, `propose_big_purchase`, `propose_categorisation`, `go_to_screen`.

- `propose_plan` input is validated against its JSON Schema (bounded lever changes); invalid
  proposals are rejected back to the model with the validation error. Proposals are saved as
  scenarios for the user to review.
- Figures in the advisor's reply MUST come from tool results; the UI renders each figure with a link
  to its run. A reply containing a monetary figure not present in a tool result in the same
  conversation is flagged "unverified figure" in the UI.
- The advisor elicits goals in conversation ("what would you do with free time?", "what standard of
  living is non-negotiable?"). Writing them as `Goal`/`Tier` drafts the user accepts or edits is
  later work.
- System prompt states: not financial advice; assumptions are the user's; recommend professional
  advice for tax/legal structure decisions.

---

## 14. Storage, security and portability

| ID | Requirement |
|---|---|
| NFR-STO-001 | Records in IndexedDB (via a thin typed wrapper). Schema migrations are versioned, append-only and tested. Simulation outputs are not persisted; they are recomputed from seeds (NFR-DET-001). OPFS is reserved for them if that changes. |
| NFR-STO-002 | **Optional encryption at rest**: a random AES-GCM-256 data key encrypts each record, bound by additional data to that record's store and key. The data key is wrapped under a passphrase key (PBKDF2-SHA-256, 600 000 iterations), so a passphrase change re-wraps one key. The app locks after 15 minutes idle (configurable) by reloading, which discards all decrypted state. Turning encryption off needs the passphrase. Forgetting the passphrase loses the data; the UI says so. ADR 0019. |
| NFR-STO-003 | **Export** everything as one `.budgetapp` file: a ZIP of a plain manifest and an AES-GCM payload (gzip of the encoded records) under a key derived from an export passphrase, independent of the at-rest key. **Import** replaces everything and keeps the device's encryption state. Round-trip is lossless (tested). |
| NFR-STO-004 | "Delete all data" removes IndexedDB, OPFS, caches, the service-worker registration and the app's local preferences for the origin, then restarts. It is also offered on the lock screen for a forgotten passphrase. |
| NFR-STO-005 | Works offline after first load (service worker, precached assets including `gssk.wasm` and `ml-core.wasm`). |
| NFR-SEC-001 | **No third-party runtime code.** The shipped app contains only this repository's code and the pinned GSSK kernel; npm packages are build and test tooling only (ADR 0007). No third-party scripts at runtime, no analytics, no telemetry. |
| NFR-SEC-002 | Imported files are parsed in workers with size limits (50 MB per file) and never evaluated. Imported text is rendered with DOM text APIs, never interpolated into HTML. |

### 14.1 Sync to user-owned storage (M12)

Local-first, with IndexedDB the source of truth on each device. ADR 0016.

| ID | Requirement |
|---|---|
| FR-SYNC-001 | Sync is opt-in per device and works through the provider's OAuth in the browser (PKCE or token client). There is no app server. |
| FR-SYNC-002 | First target: Google Drive's per-app folder (`drive.appdata` scope), or a user-visible folder (`drive.file`). Later: Dropbox app folder, OneDrive app root, and iCloud (CloudKit JS), which also serves the iOS app. |
| FR-SYNC-003 | Everything synced is encrypted on the client with the NFR-STO-002 key. The provider sees only ciphertext. |
| FR-SYNC-004 | Sync uses an encrypted append-only event log (imports, labels, rules, decisions, scenarios, receipts) plus periodic snapshots. Merge is a set union by event ID. Settings are last-writer-wins registers with hybrid logical clocks. A conflict on the same register shows both values. |
| FR-SYNC-005 | Merged state is deterministic: the ledger is rebuilt from the event log (ADR 0008). |
| FR-SYNC-006 | Provider origins are added to the CSP `connect-src`, and every sync is logged (FR-API-004). The privacy e2e test asserts that only ciphertext leaves. |
| FR-SYNC-007 | Disconnecting a provider stops sync. Local data is unaffected, and the remote copy can be deleted from Settings. |
| FR-SYNC-008 | Signing in to a provider is the only account. Social sign-in arrives with each provider's storage, not as a separate identity system. |

---

## 15. Technology

### 15.1 Stack

| Concern | Choice |
|---|---|
| Language | TypeScript 7 (`tsgo`, the native compiler), strict, erasable syntax only, explicit `.ts` imports; runs unchanged in Node ≥ 22.18 and Vite (ADR 0007) |
| Build / dev | Vite |
| UI | Native web components in the [Boba](https://github.com/sholtomaud/boba) pattern (ADR 0001): one folder per custom element (`.html`, `.css` with `:host` scoping, `.ts`), a small `BaseComponent`, an `EventTarget` store and a History-API router. No UI framework, no CSS framework. |
| Charts | Hand-written SVG components (ADR 0007) |
| Workers / RPC | Web Workers + an in-house typed `postMessage` RPC (`src/workers/rpc.ts`, ADR 0007) |
| CSV | In-house RFC 4180 parser in the `ingest` worker. No xlsx support and no SheetJS (ADR 0003). |
| Validation | In-house validators for CDR files, models and scenarios, checked against the pinned JSON Schemas in tests (ADR 0007) |
| Storage | IndexedDB (thin in-house typed wrapper), OPFS |
| Kernel | `gssk.wasm` + `gssk.js` loader from GSSK `dist/`, pinned (§15.3) |
| ML / numerics | `ml-core.wasm` (§15.2); TS reference implementations for tests |
| Optional ML | Later, and only by ADR: ONNX Runtime Web (embeddings, pretrained forecasters), WebLLM (in-browser LLM on WebGPU). These would be the only third-party runtime code, loaded only after the user opts in (ADR 0007). |
| Tests | Vitest (unit, kernel; property tests with in-house seeded generators on SplitMix64), Playwright (components, e2e, network assertions) (ADRs 0006, 0007) |
| Documentation | VitePress site built from `docs/` (guides, ADRs, this spec) (ADR 0006) |
| Lint / format | `tsc` with strict and unused-code checks, Prettier; `cargo fmt` / `clippy` for `ml-core` (ADR 0007) |

### 15.2 `ml-core` (WASM)

Rust crate compiled to `wasm32-unknown-unknown` as plain `extern "C"` exports over `f64` buffers in
linear memory, with no wasm-bindgen and no crates (ADR 0007, ADR 0011), exposing pure numeric
kernels (no strings across the boundary). The toolchain is pinned in `rust-toolchain.toml`:

- ETS fit/forecast (Holt-Winters variants), Croston/SBA/TSB, rolling-origin backtest, MASE, pinball loss;
- block bootstrap, lognormal / Student-t samplers, Weibull conditional sampling;
- streaming quantile accumulators (P² or fixed-grid histogram per month);
- naive Bayes / logistic regression training and inference on hashed n-gram features;
- CMA-ES.

Each kernel has a TypeScript reference implementation; property tests require WASM and TS outputs to
agree within 1e-9 (relative) on random inputs. The PRNG in `ml-core` is SplitMix64, matching GSSK
and the synthetic generator.

Until `ml-core` lands (M4), the TS reference implementations are used directly.

### 15.3 GSSK integration

- `vendor/gssk/` holds `gssk.wasm`, `gssk.js`, `gssk.d.ts`, `gssk.schema.json`, `gssk.h` (for reference), and `GSSK_PIN.json`:
  `{ "repo": "...", "commit": "...", "tag": "...", "sha256": { "gssk.wasm": "...", "gssk.js": "..." } }`.
- The vendored files come from GSSK's `dist` branch, the output of GSSK's own release CI
  (`make wasm` with its pinned WASI SDK). `GSSK_PIN.json` names the dist commit (ADR 0004).
- `npm run gssk:update -- <dist-commit>` copies the files from that commit of the `dist` branch and
  rewrites `GSSK_PIN.json`. `npm run gssk:verify` and the kernel tests check every file against it.
- At load the `sim` worker computes the wasm SHA-256 and refuses to run on mismatch, or if the kernel
  reports a version other than the pinned one.
- A thin typed wrapper `src/sim/gssk.ts` owns all pointer handling: string marshalling
  (`stringToUTF8`), `GSSK_Init` out-pointer, `HEAPF64` state views, freeing. Nothing else touches
  WASM memory.
- **Calibration marshalling**: `GSSK_CalibrateGradient` takes `GSSK_NodeObservations*` (a struct
  holding pointers and `size_t`). The wrapper lays these out for `wasm32` explicitly and a test pins
  the layout against the vendored kernel version. KR-1 asks GSSK for a flat entry point that removes
  this.

---

## 16. Quality

### 16.1 Tests

| Layer | What |
|---|---|
| Unit | Money parsing, period normalisation, dedupe, transfer pairing, tax calculation (table-driven against ATO worked examples), each forecaster, each sampler, modelgen output. |
| Property | Ingest: import order and page overlap never change the result. Synth: balances always reconcile. Sim: conservation holds; doubling all OPEX never increases pSuccess; more starting capital never decreases pSuccess (with common random numbers). |
| Golden | Fixed persona + seed → fixed `transactions` hash, fixed forecast quantiles, fixed pSuccess (to 1e-12). Changes require an explicit fixture update in the PR. |
| Kernel | GSSK wrapper against the vendored wasm: init/step/reset/setEdgeK/mutation log/replay round-trip; SHA pin check. |
| E2E (Playwright) | Synthetic persona end to end: import → classify → budget → forecast → freedom → scenario compare → export → delete → import export. |
| Privacy | E2E with all APIs off asserts zero requests outside the app origin. With a mock provider on, asserts the payload matches the confirmed preview and contains no redacted field. |

### 16.2 Evaluation page (`/eval`, dev builds only)

Runs classification, CAPEX detection and forecasting against `truth.json` for each committed persona
and prints accuracy, confusion matrix, MASE and pinball loss. CI runs the same and fails below the
thresholds in FR-CLS-005 and these:

- CAPEX detection: precision ≥ 0.9, recall ≥ 0.9 on `high-capex-crypto`;
- OPEX forecast: chosen method's out-of-sample MASE ≤ seasonal-naive MASE on ≥ 80 % of categories,
  pooled over the committed personas at five seeds (ADR 0011);
- Replacement-date P10–P90 interval covers the true date for 75–90 % of assets.

### 16.3 Performance budgets

First load ≤ 400 kB JS gzipped excluding wasm and optional ONNX/LLM assets; import of 10 000
transactions ≤ 3 s; classification of 10 000 ≤ 2 s; FR-SIM-005 for Monte-Carlo.

### 16.4 CI and data hygiene

CI (`.github/workflows/ci.yml`) runs on every pull request and push, in three parallel jobs:
**build** (data-hygiene gate, GSSK pin check, format check, typecheck, app build, bundle size, docs build;
later also `ml-core` build), **test** (Vitest: unit, property, golden, kernel; later also
eval thresholds and `ml-core` tests) and **e2e** (Playwright, including privacy tests).

**Data-hygiene gate (NFR-PRIV-002)**, run in CI and as a pre-commit hook:

- `.gitignore` excludes `data/`, `private/`, `*.budgetapp`, `*.xlsx`/`*.xls` (everywhere), `*.csv` outside
  `fixtures/`, `*.ofx`, `*.qfx`, `*.qif`. The gate also rejects those file types if they are force-added.
- Every JSON under `fixtures/` must carry the top-level `x-synthetic` key. Every CSV under `fixtures/`
  must start with a `# x-synthetic: …` line.
- Any committed file containing a CDR-shaped `accountId` not starting `SYN-`, a BSB-and-account-number
  pattern, or an Australian TFN pattern (formatted, with a valid ATO check digit) fails the build.

### 16.5 Contribution workflow

`AGENTS.md` is the canonical standard (as in GSSK). Work lands through PRs with green CI; the author
does not merge their own PR. ADRs live in `docs/adr/` for decisions such as the UI framework, the
quantile accumulator, and every deviation from this spec.

### 16.6 Deployment

The app and the documentation are published to **GitHub Pages** by the same workflow. A `deploy`
job runs only on pushes to `main`, and only after `build`, `test` and `e2e` pass. The app is served
at `/<repo>/` (built with `BASE_PATH`, with a `404.html` copy of the shell for deep links). The
VitePress docs are served at `/<repo>/docs/`. Pages is a static host, which matches §1.1: no
server-side code, and nothing but the app's own static assets.

---

## 17. Kernel requests to GSSK (non-blocking)

The app works around each of these. Each, if accepted by GSSK, simplifies the app and is adopted by a
deliberate pin update.

| ID | Request | Current workaround |
|---|---|---|
| KR-1 | A flat calibration entry point (parallel arrays: node indices, times, values, counts) so no struct crosses the WASM boundary, following the precedent of the flat ensemble getters. | Hand-laid `wasm32` struct, pinned by a test. |
| KR-2 | Ensemble output beyond min/mean/max: quantile envelopes, or a per-run callback/export. | App-level Monte-Carlo loop with its own quantile accumulators. |
| KR-3 | A documented position on negative edge `k` (allowed or rejected). | Paired gain/loss edges, never negative. |
| KR-4 | A git tag per release, so the pin can name a tag rather than a commit. | Pin by commit SHA. |
| KR-5 | Optional distribution families for `jitter` (normal/lognormal/Student-t), seeded per run. | Controller-set `k` from app-sampled paths. |
| KR-6 | A per-carrier boundary-flux accessor (inflow from sources per step, consistent with the integrator's stages), so conservation can be checked for open models. `GSSK_GetCarrierConservationError` reports the relative change in storage, which for an open model is net flow, not leakage. Also: `gssk.h` comments sinks as `dQ/dt = 0`, but sink Q accumulates its inflow. Document or correct this. | App-side balance check (FR-SIM-003, ADR 0005). |
| KR-7 | A way to switch off the per-step motif scan (Phase 9 pattern discovery), e.g. a `config` flag, or a scan only on request. In 5.3.0 it formats every motif with `printf` after each `GSSK_Step` and dominates the step time of a 17-edge model. | One OPEX sink instead of one per group; a worker pool (ADR 0012). |

---

## 18. Repository layout

```
budget-app/
├─ AGENTS.md  CLAUDE.md  README.md  SPEC.md  LICENSE
├─ docs/
│  ├─ .vitepress/config.ts        VitePress site config
│  ├─ adr/                       0001-ui-framework.md … 0007-no-third-party-runtime.md
│  ├─ guide/                     getting-started, architecture, testing, deployment
│  ├─ spec.md                    includes ../SPEC.md
│  └─ user-guide.md
├─ data/                         # git-ignored; local scratch only
├─ fixtures/                     # synthetic only, x-synthetic marked
│  ├─ personas/                  frugal-renter.json, default.json, high-capex-crypto.json
│  └─ syn-<persona>-42/          generated CDR files + truth.json + workbook/*.csv (`npm run fixtures`;
│                                 a test checks they match the generator byte for byte)
├─ schemas/
│  ├─ cdr/                       JSON Schemas derived from Consumer Data Standards v1.36.0
│  ├─ persona.schema.json  scenario.schema.json  goal.schema.json
├─ data-tables/
│  ├─ tax/au-2025-26.json        source URL, verifiedBy, verifiedOn
│  ├─ mcc-categories.json
│  └─ asset-lifetimes.json       default life + Weibull shape per category
├─ vendor/gssk/                  gssk.wasm, gssk.js, gssk.d.ts, gssk.schema.json, gssk.h, GSSK_PIN.json
├─ ml-core/                      Rust crate → ml-core.wasm
├─ src/
│  ├─ app/                       core/ (BaseComponent, Store, Router), components/<tag>/ (.html .css .ts)
│  ├─ lib/                       prng (SplitMix64), money, dates, hash, jsonschema, csv, zip
│  ├─ domain/                    canonical types (§5)
│  ├─ ingest/                    cdr/ (VERSION, parse), ledger (dedupe, pending, transfers, reconcile), service
│  ├─ synth/                     persona.ts, generator.ts, cli.ts
│  ├─ classify/                  rules.ts, memory.ts, model.ts, llm.ts
│  ├─ budget/                    periods.ts, tiers.ts, actuals.ts, capex.ts
│  ├─ forecast/                  opex.ts, capex.ts, returns.ts, ref/ (TS reference impls)
│  ├─ sim/                       gssk.ts, modelgen.ts, controller.ts, tax.ts, montecarlo.ts
│  ├─ goals/                     metrics.ts, optimise.ts
│  ├─ advisor/                   tools.ts, providers/, redact.ts
│  ├─ store/                     idb.ts (wrapper + migrations), import-store.ts; later crypto.ts, export.ts
│  ├─ sw/                        service-worker template (precache list filled at build)
│  └─ workers/                   one entry per worker
├─ tests/                        unit/, property/, golden/, kernel/, e2e/ (privacy tests live in e2e/)
├─ scripts/                      gssk-update.sh, gssk-verify.ts, data-hygiene.ts, bundle-size.ts (run by Node directly)
├─ .githooks/                    pre-commit (data-hygiene gate on staged files)
└─ .github/workflows/ci.yml
```

---

## 19. Milestones

Each milestone ends with a merged PR, green CI, and its acceptance criteria demonstrated on synthetic
data.

| M | Scope | Acceptance |
|---|---|---|
| **M0 Skeleton** | Repo, AGENTS.md, CI, data-hygiene gate, Vite app shell, vendored GSSK with pin check, ADR for UI framework, VitePress docs, GitHub Pages deployment | CI green; app loads offline; `gssk.wasm` hash verified; household example model runs in a worker |
| **M1 Synthetic + ingest** | Persona schema, generator (CLI + in-app), three personas, CDR schemas + importer, dedupe, pending→posted, transfers, reconciliation | FR-SYN-001…006; FR-ING-001…008; FR-REC-001; property tests pass |
| **M2 Ledger + classification** | Ledger UI, rules, merchant memory, MCC map, NB/LR model, CAPEX proposals, refunds | FR-CLS-001…005 thresholds met in CI |
| **M3 Budget + workbook + CAPEX register** | CSV mapping wizard and presets, tiers, actual vs budget, CAPEX register, sinking fund | FR-ING-010…014 on the synthetic workbook CSVs; FR-BUD-001; FR-CAP-001…005 |
| **M4 Forecasting + ml-core** | OPEX and CAPEX forecasters, backtests, fan charts; `ml-core` crate with WASM/TS parity | FR-FC-001, FR-FC-010; §16.2 forecast thresholds |
| **M5 Freedom simulation** | modelgen, controller, tax tables, withdrawal strategies, return models, Monte-Carlo, metrics, Freedom screen | FR-SIM-001…006; FR-GOAL metrics; FR-SIM-006 bridge test |
| **M6 Scenarios + optimiser** | Scenario compare, optimiser, Pareto view, shortfall drivers | FR-OPT-001; monotonicity property tests |
| **M7 Storage, encryption, export** | Encryption at rest, export/import, delete-all, migrations | NFR-STO-001…005 |
| **M8 Optional APIs + advisor** | Provider settings, consent + redaction, price-history import (fetch deferred, ADR 0021), LLM classification, LLM mapping assistant (structured outputs), advisor with tools | FR-API-001…005; FR-ING-017 (proposes the wizard's mapping; the full mapping spec of FR-ING-015 and per-column provenance of FR-ING-018 move to M10); §13.3; privacy tests |
| **M9 Bayesian workflow** | Bayesian structural time series with pooling and a shared spending factor, return-parameter uncertainty, ml-core samplers with parity, model checks (ADRs 0015, 0022) | FR-BAY-001…008; calibration gates in CI |
| **M10 Real data** | User loads own exports locally; bank-specific CSV adapters as needed; learned in-browser CSV mapper | Reconciliation clean on real exports (verified locally, nothing committed); FR-ING-016 accuracy gate |
| **M11 Live connections (production)** | Optional connector (§6.4): CDR consent via an accredited partner, or bank personal-API plugins; sync into the existing import pipeline; consent management in Settings | FR-LIVE-001…006; a sync from a CDR sandbox passes the same validation, dedupe and reconciliation tests as file import; the privacy e2e shows egress only to the configured connector origin |
| **M12 Sync** | Local-first sync to user-owned storage, Google Drive first, end-to-end encrypted (ADR 0016) | FR-SYNC-001…008; two-device merge property tests; privacy e2e shows ciphertext only |
| **M13 Receipts** | iOS companion app (separate repository), receipt contract, reconciliation of line items to bank transactions (ADR 0017) | FR-RCPT-001…007 on synthetic receipts |
| **M14 Offers and agents** | On-device offer matching, intent marketplace, mandated agent actions; only after the legal review gate (ADR 0018) | FR-OFR-…, FR-AGT-…; NFR-MON-001…007; privacy e2e shows offer matching sends nothing |

---

## 20. Open questions

1. ~~**UI framework**: Preact vs Svelte (M0 ADR).~~ Resolved: native web components, Boba pattern (ADR 0001).
2. **Superannuation**: model as a holding with `accessibleFrom` only, or with contribution caps and
   Div 293/296 rules? (Proposed: holding + preservation age in M5; caps and Div 296 as a later tax
   table extension.)
3. **Housing**: rent-vs-buy in M6 needs loan amortisation and stamp duty tables. Which states?
4. **Couple mode**: one household with two incomes, or two people with separate tax? (Proposed: two
   tax persons from M5, one shared household budget.)
5. **Project income**: model chosen-work income (grants, consulting, product) as a separate stochastic
   source with its own distribution?
6. **Time as a carrier**: track hours (paid work vs chosen work) as a second GSSK carrier so the
   freedom goal is expressed in time as well as money?
7. **In-browser LLM**: which model size is acceptable on the target devices (WebGPU availability)?
8. **Live connections (M11)**: which route — a sponsor or CDR-representative arrangement with an
   accredited intermediary, a self-hosted connector for users who hold their own accreditation
   arrangement, or bank-specific personal APIs? Who operates the connector, and at what cost?
9. **Learned CSV mapper**: is a kilobyte-scale classifier enough, or is a small embedding model for
   header semantics worth an ADR 0007 exception (ONNX/WebGPU weights)? Decide on the M10 accuracy
   gate.
10. **Bayesian priors**: from the synthetic population only, or from published household-spending
    statistics (labelled `assumed`)?
11. **Sync providers after Google Drive**: iCloud (best for the iOS app) or Dropbox/OneDrive first?
12. **Receipts on Android**: needed, or is the receipt contract plus file import enough?
13. **Monetisation and licensing** (gate for M14): which legal advice, and for which markets? Is
    the app an information service, or does any feature amount to financial product or credit
    advice? Do CDR-derived signals ever enter offer matching on the device, given the CDR Rules on
    use and direct marketing?
14. **Business model order**: subscription and B2B first (no data use), then private offers, then
    the intent marketplace? Is a data cooperative ("data dividend") worth exploring at all?

---

## 21. Glossary

| Term | Meaning |
|---|---|
| CDR | Consumer Data Right, Australia's open-banking regime; its Consumer Data Standards define the Banking API payloads ingested here |
| OPEX | recurring operating expenditure: rent, food, bills, subscriptions |
| CAPEX | capital expenditure: durable or lumpy purchases with a life (laptop, watch, pen, holiday treated as a periodic lump) |
| Tier | a standard of living, expressed as multipliers on budget lines |
| Freedom capital | capital whose passive cashflow funds a tier indefinitely (or to a horizon) with probability ≥ target |
| pSuccess | share of Monte-Carlo runs meeting the goal |
| Sinking fund | regular saving that funds expected CAPEX replacements |
| GSSK | the Odum-ESL stock-and-flow kernel this app runs on |
| Mandate | a user-approved, bounded instruction under which the user's agent may act (FR-AGT-001) |
| Mapping spec | the JSON description of how a CSV's columns and rows map into the app's records (FR-ING-015) |

---

## 22. Monetisation and the agentic layer (proposed, M14)

The app knows things about a household that are valuable to sellers, and calibrated:
- when a replacement is due (§9.3);
- what fits the budget (§9.1);
- what is on the wish list;
- what a purchase does to the household's freedom (§11.3).

It turns that into value **without the data leaving the device** (NFR-MON-001, ADR 0018). Nothing
here is built before the legal review gate (open question 13).

The app is a **broker, or matchmaker**. Partners pay for relevance and timing that only the device
knows, and the device never hands the data over. Users share in the revenue their attention and
their (opt-in, aggregated) data create.

### 22.1 Revenue paths, in build order

1. **User-paid:** a subscription for hosted conveniences (sync options, receipts app, live bank
   connector, hosted advisor credits); B2B for licensed planners and employers. Uses no data.
2. **Private offers:** retailers publish a public offers feed, and the device matches and ranks it.
3. **Intent marketplace:** the user publishes an anonymous, expiring want, and retailers answer.
4. **Agent commerce:** the user's agent acts on mandates (price watch, buy-within-mandate, bill
   switching).
5. **Aggregate insights:** only as an opt-in, differentially private data cooperative, with revenue
   shared back. Maybe never.

### 22.2 Offers (FR-OFR)

| ID | Requirement |
|---|---|
| FR-OFR-001 | Retailers publish offers to a public, signed feed: product, price, validity, region, category and intent tags (e.g. `capex.computing`, `replacement`, `wish:*`), and a bid per conversion. A public offers API handles publishing and conversion postbacks. |
| FR-OFR-002 | Every device fetches the same feed, or the same coarse regional shard. A fetch carries no user data. |
| FR-OFR-003 | Matching runs on the device, against the wish list, open replacement windows (P10–P90), budget headroom at the goal tier, and the purchase's effect on pSuccess. |
| FR-OFR-004 | Ranking is by user benefit: expected saving × probability of need within the offer's validity, from the forecast's posterior (§10.4). The bid only breaks ties. |
| FR-OFR-005 | Every placement says **Sponsored**, who paid, and why it matched ("your laptop's replacement window is open; within your Independent budget"). |
| FR-OFR-006 | Personalised creative is generated from the offer and a style the device picks. User attributes are never sent to an image service. AI-generated imagery is labelled. |
| FR-OFR-007 | Measurement uses the link or coupon the user chooses to follow, plus opt-in aggregate counts with k-anonymity and differential privacy. |
| FR-OFR-008 | Excluded from matching: shortfall, debt, gambling or hardship signals. Not carried: credit, buy-now-pay-later and gambling offers (NFR-MON-001). |
| FR-OFR-009 | Intent marketplace: the user publishes a specific want (item, price range, time window, coarse region). It goes through a relay with no identifiers, expires and is revocable. |
| FR-OFR-010 | Retailers' answers arrive as offers. The user's agent compares them on price, total cost and pSuccess impact, and the user chooses. |
| FR-OFR-011 | Retailers pay per qualified answer or per sale, disclosed to the user. |

### 22.2a User revenue share (FR-RWD)

Users share in what their attention and their opt-in co-op data earn. The model is Brave's, where
users receive most of the ad revenue their attention creates. Rewards must never pull against the
mission.

| ID | Requirement |
|---|---|
| FR-RWD-001 | A published share of offer and marketplace revenue goes back to the users it came from, and an aggregate transparency report shows the split. |
| FR-RWD-002 | **Rewards never reward spending.** They accrue for viewing and evaluating matched offers, answering an intent, or contributing to the co-op. They never accrue for buying, and never more for spending more. The app always says when "no purchase" is the best choice for the user's goal. |
| FR-RWD-003 | Rewards are counted on the device and redeemed privately, with blinded tokens or aggregate attestations, so redemption doesn't reveal which offers were seen. |
| FR-RWD-004 | Payout is in money or a direct transfer to the user's savings goal. There are no speculative tokens, and no points that only buy a partner's goods. Tax treatment is stated. |
| FR-RWD-005 | **Data co-op dividend:** members who opt in to the differentially private co-op (§22.1, path 5) receive a share of what the aggregates earn, in proportion to their contribution, under published rules. |

### 22.2b Partner certification (FR-PTN)

No scammers, and no one who profits from financial stress. Only certified partners can publish to
the offers feed or answer intents.

| ID | Requirement |
|---|---|
| FR-PTN-001 | **Verified identity:** ABN/ACN checked against the Australian Business Register, verified beneficial owners and contact, and a signed partner agreement. Each partner's feed entries are signed with their registered key. Unsigned or revoked entries are dropped on the device. |
| FR-PTN-002 | **A partner charter**, a binding condition of listing: no targeting or exploiting financial stress; no credit, buy-now-pay-later, gambling, payday lending or speculative products; truthful pricing; disclosed fees; easy returns per the Australian Consumer Law. |
| FR-PTN-003 | **Offer review:** automated checks on every offer (prohibited categories, scam patterns, URL reputation, whether the "was" price matches the partner's own published price history) and human review of new partners' first offers. |
| FR-PTN-004 | **Users can report an offer** from the offer itself. Reports suspend an offer or partner pending review. Outcomes are published in the transparency report. |
| FR-PTN-005 | **Revocation:** a partner found in breach is delisted and its key revoked. The device refreshes the revocation list with every feed fetch. |
| FR-PTN-006 | **Accountability:** an annual independent audit of the certification process and the guardrails, published. An external standard may be adopted where one fits (for example B Corp certification for the operator, or an industry code). |

### 22.3 The user's agent (FR-AGT)

| ID | Requirement |
|---|---|
| FR-AGT-001 | The agent acts only under a **mandate** the user creates: what to buy or switch, a price cap, a time window, and whether each action needs approval or is pre-approved up to a spend cap. |
| FR-AGT-002 | Price watch and buy-within-mandate for planned CAPEX and wish-list items. The agent talks to merchant agents (MCP or agent-to-agent protocols) and checks out through the merchant's checkout. It never has bank write access (§1.1). |
| FR-AGT-003 | Selective disclosure: the agent may answer a merchant's "would you buy X at Y?" with yes, no or a counter-offer, from local data, without revealing that data. |
| FR-AGT-004 | Bill switching (energy, mobile, insurance) with disclosed referral fees. Credit and insurance only once licensing is resolved. |
| FR-AGT-005 | Every agent action is logged with its mandate, the merchant, the amount and the fee earned. It appears in the ledger like any transaction. |
| FR-AGT-006 | Revenue is affiliate commission or a success fee on purchases the user approved, stated in the mandate. |
| FR-AGT-007 | The advisor (§13.3) cannot see bids or fees. Its figures come only from tool results (NFR-HON-002). It is never paid to recommend. |
| FR-AGT-008 | Mandates are revocable at any time, and expire by default. |

---

## Appendix A — CDR transaction page (synthetic example)

```json
{
  "x-synthetic": { "generator": "budget-app/synth@0.1.0", "seed": "42" },
  "data": {
    "transactions": [
      {
        "accountId": "SYN-TXN",
        "transactionId": "SYN-TXN-000193",
        "isDetailAvailable": false,
        "type": "PAYMENT",
        "status": "POSTED",
        "description": "FRESH FIELDS 0231 NEWTOWN AU",
        "postingDateTime": "2025-03-14T09:12:00+11:00",
        "executionDateTime": "2025-03-13T17:40:22+11:00",
        "amount": "-63.85",
        "currency": "AUD",
        "reference": "",
        "merchantName": "Fresh Fields",
        "merchantCategoryCode": "5411"
      }
    ]
  },
  "links": {
    "self": "https://synthetic.invalid/banking/accounts/SYN-TXN/transactions?page=3",
    "first": "https://synthetic.invalid/banking/accounts/SYN-TXN/transactions?page=1",
    "prev": "https://synthetic.invalid/banking/accounts/SYN-TXN/transactions?page=2",
    "next": "https://synthetic.invalid/banking/accounts/SYN-TXN/transactions?page=4",
    "last": "https://synthetic.invalid/banking/accounts/SYN-TXN/transactions?page=9"
  },
  "meta": { "totalRecords": 412, "totalPages": 9 }
}
```

## Appendix B — Generated GSSK model (fragment)

```jsonc
{
  "metadata": { "schema_version": 4, "name": "freedom:scenario-7f3a" },
  "config": { "t_start": 0, "t_end": 480, "dt": 1, "method": "rk4" },
  "carriers": [ { "id": "money", "unit": "AUD", "conserved": true } ],
  "nodes": [
    { "id": "wages",       "type": "source",  "carrier": "money", "value": 1 },
    { "id": "market",      "type": "source",  "carrier": "money", "value": 1 },
    { "id": "bank",        "type": "storage", "carrier": "money", "value": 12000 },
    { "id": "etf",         "type": "storage", "carrier": "money", "value": 250000 },
    { "id": "btc",         "type": "storage", "carrier": "money", "value": 180000 },
    { "id": "opex_housing","type": "sink",    "carrier": "money", "value": 0 },
    { "id": "capex",       "type": "sink",    "carrier": "money", "value": 0 },
    { "id": "tax",         "type": "sink",    "carrier": "money", "value": 0 },
    { "id": "market_loss", "type": "sink",    "carrier": "money", "value": 0 }
  ],
  "edges": [
    { "id": "pay", "origin": "wages", "target": "bank", "carrier": "money", "logic": "constant",
      "params": { "k": 0 },
      "forcing": { "waveform": "table", "times": [0, 12, 36], "values": [8200, 8450, 0], "interpolation": "step", "extrapolation": "hold" } },
    { "id": "rent", "origin": "bank", "target": "opex_housing", "carrier": "money", "logic": "constant",
      "params": { "k": 0 },
      "forcing": { "waveform": "table", "times": [0, 1, 2], "values": [2690, 2702, 2715], "interpolation": "step", "extrapolation": "hold" } },
    { "id": "etf_gain", "origin": "market", "target": "etf", "carrier": "money", "logic": "interaction",
      "params": { "k": 0, "control_node": "etf" } },
    { "id": "etf_loss", "origin": "etf", "target": "market_loss", "carrier": "money", "logic": "linear",
      "params": { "k": 0 } },
    { "id": "etf_draw", "origin": "etf", "target": "bank", "carrier": "money", "logic": "constant",
      "params": { "k": 0 } },
    { "id": "tax_paid", "origin": "bank", "target": "tax", "carrier": "money", "logic": "constant",
      "params": { "k": 0 } }
  ]
}
```

Field names in Appendix B are illustrative; `modelgen` MUST emit exactly what the pinned
`gssk.schema.json` accepts, and a test validates every generated model against that schema and
against `GSSK_Init`.
