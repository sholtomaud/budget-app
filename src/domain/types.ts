/** The canonical data model (SPEC §5). Money is integer minor units. */
import type { IsoDate } from '../lib/dates.ts';

export type Provenance =
  'actual' | 'budgeted' | 'calibrated' | 'forecast' | 'assumed' | 'illustrative';

export type AccountRole =
  'transaction' | 'savings' | 'offset' | 'credit' | 'loan' | 'investment' | 'super';

export interface Account {
  id: string;
  displayName: string;
  productCategory: string;
  productName?: string;
  maskedNumber?: string;
  role: AccountRole;
  currency: string;
  source: { kind: 'cdr-file' | 'synthetic' | 'manual'; fileHash?: string };
  provenance: Provenance;
}

export type ClassificationKind =
  'income' | 'opex' | 'capex' | 'transfer' | 'investment' | 'tax' | 'fee' | 'interest' | 'refund';

export interface Classification {
  kind: ClassificationKind;
  categoryId: string;
  assetId?: string;
  confidence: number;
  by: 'structural' | 'rule' | 'memory' | 'mcc' | 'model' | 'llm' | 'user';
  ruleId?: string;
  modelVersion?: string;
}

export interface Txn {
  /** CDR transactionId, or a stable hash when absent (FR-ING-004). */
  id: string;
  accountId: string;
  /** True when `id` was synthesised because the file had no transactionId. */
  idSynthetic: boolean;
  status: 'PENDING' | 'POSTED';
  cdrType: string;
  postedAt?: string;
  valueAt?: string;
  executedAt?: string;
  /** Local calendar date in the user's timezone (FR-ING-008). */
  date: IsoDate;
  /** Negative = outgoing, as in CDR. */
  amount: bigint;
  currency: string;
  description: string;
  reference?: string;
  merchantName?: string;
  mcc?: string;
  billerCode?: string;
  billerName?: string;
  /** Unknown fields from the file, kept verbatim (FR-ING-002). */
  raw?: Record<string, unknown>;
  /** Set when a POSTED record supersedes this PENDING one (FR-ING-005). */
  supersededBy?: string;
  /** Links the two legs of an internal transfer (FR-ING-007). */
  transferPairId?: string;
  classification?: Classification;
  /** Imports that contained this record. */
  importIds: string[];
  provenance: Provenance;
}

/** A balance checkpoint from a CDR balances file (FR-REC-001). */
export interface BalanceCheckpoint {
  accountId: string;
  /** When the balance was observed. */
  asAt: string;
  date: IsoDate;
  current: bigint;
  available?: bigint;
  creditLimit?: bigint;
  currency: string;
  /** How asAt was obtained: from the file's x-as-at, or assumed from the file's time. */
  asAtSource: 'file' | 'assumed';
  importId: string;
}

export interface ImportCounts {
  new: number;
  duplicate: number;
  superseded: number;
  rejected: number;
}

export interface ImportFileResult {
  name: string;
  sha256: string;
  kind: 'accounts' | 'balances' | 'transactions' | 'unknown';
  status: 'imported' | 'duplicate-file' | 'rejected' | 'skipped';
  message?: string;
  counts: ImportCounts;
}

/** One import, undoable as a unit (FR-ING-006). */
export interface ImportRecord {
  id: string;
  at: string;
  label: string;
  synthetic: boolean;
  files: ImportFileResult[];
  counts: ImportCounts;
}

/** A capital item in the CAPEX register (SPEC §5, §9.3). */
export interface Asset {
  id: string;
  name: string;
  categoryId: string;
  purchasedAt?: string;
  cost: { minor: bigint; ccy: string };
  forecastCost?: { minor: bigint; ccy: string };
  life: { meanYears: number; shape?: number };
  /** True when the life came from the category default, not the user (FR-CAP-005). */
  lifeAssumed: boolean;
  replace: boolean;
  replacementCostGrowth?: number;
  status: 'wish' | 'planned' | 'owned' | 'retired';
  tier?: string;
  /** Wish-list decision (FR-CAP-004). */
  decision?: { action: 'buy' | 'defer' | 'drop'; by?: string };
  linkedTxnIds: string[];
  url?: string;
  /** Where it came from when imported from a CAPEX register CSV (FR-ING-013). */
  source?: { file: string; row: number };
  provenance: Provenance;
}
