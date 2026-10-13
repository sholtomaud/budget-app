/**
 * The ledger: accounts, transactions and balance checkpoints built from
 * imported CDR files (FR-ING-001…008, FR-REC-001).
 *
 * Imports are folded into the ledger one at a time. Links between records
 * (pending → posted, transfer pairs) are recomputed from scratch after each
 * import in a canonical order, so the result never depends on the order in
 * which files or imports arrived.
 */
import type {
  Account,
  BalanceCheckpoint,
  ImportCounts,
  ImportFileResult,
  Txn,
} from '../domain/types.ts';
import { dayNumber, localDateOf, type IsoDate } from '../lib/dates.ts';
import { parseAmount } from '../lib/money.ts';
import type { CdrAccount, CdrPayload, CdrTransaction } from './cdr/parse.ts';
import { syntheticTxnId, txnKey } from './ids.ts';
import { inferRole } from './roles.ts';
import { descriptionSimilarity } from './similarity.ts';

export interface Ledger {
  timezone: string;
  accounts: Map<string, Account>;
  txns: Map<string, Txn>;
  /** Keyed by accountId + asAt. */
  balances: Map<string, BalanceCheckpoint>;
  /** SHA-256 of every file already imported (FR-ING-006). */
  fileHashes: Set<string>;
}

/** A file that has been read and recognised, ready to fold into the ledger. */
export interface ParsedFile {
  name: string;
  sha256: string;
  /** When the file was last modified; the as-at time for balances without x-as-at. */
  lastModified?: string;
  payload: CdrPayload;
}

export const PENDING_MATCH_DAYS = 7;
export const PENDING_SIMILARITY = 0.5;
export const TRANSFER_MATCH_DAYS = 3;
export const RECONCILE_TOLERANCE = 100n; // AUD 1, in cents

export function emptyLedger(timezone = 'Australia/Sydney'): Ledger {
  return {
    timezone,
    accounts: new Map(),
    txns: new Map(),
    balances: new Map(),
    fileHashes: new Set(),
  };
}

const zero = (): ImportCounts => ({ new: 0, duplicate: 0, superseded: 0, rejected: 0 });

const KNOWN_TXN_FIELDS = new Set([
  'accountId',
  'transactionId',
  'isDetailAvailable',
  'type',
  'status',
  'description',
  'postingDateTime',
  'valueDateTime',
  'executionDateTime',
  'amount',
  'currency',
  'reference',
  'merchantName',
  'merchantCategoryCode',
  'billerCode',
  'billerName',
  'x-id-synthetic',
]);

function accountFrom(a: CdrAccount, synthetic: boolean, fileHash: string): Account {
  const names = [a.displayName, a.nickname, a.productName].filter(Boolean).join(' ');
  return {
    id: a.accountId,
    displayName: a.nickname || a.displayName || a.accountId,
    productCategory: a.productCategory,
    productName: a.productName,
    maskedNumber: a.maskedNumber,
    role: inferRole(a.productCategory, names),
    currency: 'AUD',
    source: {
      kind: synthetic ? 'synthetic' : a['x-source'] === 'csv' ? 'csv-file' : 'cdr-file',
      fileHash,
    },
    provenance: synthetic ? 'illustrative' : 'actual',
  };
}

function placeholderAccount(accountId: string, synthetic: boolean): Account {
  return {
    id: accountId,
    displayName: accountId,
    productCategory: 'UNKNOWN',
    role: 'transaction',
    currency: 'AUD',
    source: { kind: synthetic ? 'synthetic' : 'cdr-file' },
    provenance: synthetic ? 'illustrative' : 'actual',
  };
}

async function txnFrom(
  t: CdrTransaction,
  tz: string,
  importId: string,
  synthetic: boolean
): Promise<Txn> {
  const when = t.postingDateTime ?? t.valueDateTime ?? t.executionDateTime;
  if (!when) throw new Error('has no postingDateTime, valueDateTime or executionDateTime');
  const currency = t.currency ?? 'AUD';
  const amount = parseAmount(t.amount, currency);
  const id =
    t.transactionId ??
    (await syntheticTxnId({
      accountId: t.accountId,
      ...(t.postingDateTime ? { postingDateTime: t.postingDateTime } : {}),
      ...(t.executionDateTime ? { executionDateTime: t.executionDateTime } : {}),
      amount: t.amount,
      description: t.description,
    }));
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) if (!KNOWN_TXN_FIELDS.has(k)) raw[k] = v;
  const txn: Txn = {
    id,
    accountId: t.accountId,
    // CSV rows carry an id hashed from their fields (ADR 0030).
    idSynthetic: t.transactionId === undefined || t['x-id-synthetic'] === true,
    status: t.status,
    cdrType: t.type,
    date: localDateOf(when, tz),
    amount,
    currency,
    description: t.description,
    importIds: [importId],
    provenance: synthetic ? 'illustrative' : 'actual',
  };
  if (t.postingDateTime) txn.postedAt = t.postingDateTime;
  if (t.valueDateTime) txn.valueAt = t.valueDateTime;
  if (t.executionDateTime) txn.executedAt = t.executionDateTime;
  if (t.reference) txn.reference = t.reference;
  if (t.merchantName) txn.merchantName = t.merchantName;
  if (t.merchantCategoryCode) txn.mcc = t.merchantCategoryCode;
  if (t.billerCode) txn.billerCode = t.billerCode;
  if (t.billerName) txn.billerName = t.billerName;
  if (Object.keys(raw).length) txn.raw = raw;
  return txn;
}

/**
 * Fold one import's files into the ledger (mutating it) and recompute the
 * derived links. Returns a result per file (FR-ING-006).
 */
export async function applyImport(
  ledger: Ledger,
  importId: string,
  files: ParsedFile[]
): Promise<ImportFileResult[]> {
  const results: ImportFileResult[] = [];
  const introducedBy = new Map<string, number>();
  const supersededBefore = new Set(
    [...ledger.txns.values()].filter((t) => t.supersededBy).map((t) => txnKey(t.accountId, t.id))
  );

  // Accounts first, so transactions find their account whatever the file order.
  const ordered = [...files.keys()].sort(
    (a, b) => kindRank(files[a]!.payload.kind) - kindRank(files[b]!.payload.kind)
  );
  const byIndex = new Map<number, ImportFileResult>();

  for (const i of ordered) {
    const f = files[i]!;
    const counts = zero();
    const result: ImportFileResult = {
      name: f.name,
      sha256: f.sha256,
      kind: f.payload.kind,
      status: 'imported',
      counts,
    };
    byIndex.set(i, result);
    if (ledger.fileHashes.has(f.sha256)) {
      result.status = 'duplicate-file';
      result.message = 'Already imported; nothing changed';
      counts.duplicate = f.payload.items.length;
      continue;
    }
    ledger.fileHashes.add(f.sha256);
    const synthetic = f.payload.synthetic;

    if (f.payload.kind === 'accounts') {
      for (const a of f.payload.items) {
        const existing = ledger.accounts.get(a.accountId);
        const next = accountFrom(a, synthetic, f.sha256);
        if (existing && existing.productCategory !== 'UNKNOWN') {
          counts.duplicate++;
          // Keep a role the user may have set; refresh names from the newer export.
          ledger.accounts.set(a.accountId, { ...next, role: existing.role });
        } else {
          counts.new++;
          ledger.accounts.set(a.accountId, next);
        }
      }
    } else if (f.payload.kind === 'balances') {
      const asAt = f.payload.asAt ?? f.lastModified;
      if (!asAt) {
        result.status = 'rejected';
        result.message =
          'Balance file has no x-as-at and no file time; cannot place the balances in time';
        counts.rejected = f.payload.items.length;
        ledger.fileHashes.delete(f.sha256);
        continue;
      }
      for (const b of f.payload.items) {
        const currency = b.currency ?? 'AUD';
        const key = `${b.accountId}\u001f${asAt}`;
        if (ledger.balances.has(key)) {
          counts.duplicate++;
          continue;
        }
        try {
          const cp: BalanceCheckpoint = {
            accountId: b.accountId,
            asAt,
            date: localDateOf(asAt, ledger.timezone),
            current: parseAmount(b.currentBalance, currency),
            available: parseAmount(b.availableBalance, currency),
            currency,
            asAtSource: f.payload.asAt ? 'file' : 'assumed',
            importId,
          };
          if (b.creditLimit) cp.creditLimit = parseAmount(b.creditLimit, currency);
          ledger.balances.set(key, cp);
          if (!ledger.accounts.has(b.accountId))
            ledger.accounts.set(b.accountId, placeholderAccount(b.accountId, synthetic));
          counts.new++;
        } catch {
          counts.rejected++;
        }
      }
    } else {
      for (const t of f.payload.items) {
        let txn: Txn;
        try {
          txn = await txnFrom(t, ledger.timezone, importId, synthetic);
        } catch (e) {
          counts.rejected++;
          result.message ??= `A transaction ${(e as Error).message}`;
          continue;
        }
        if (!ledger.accounts.has(txn.accountId))
          ledger.accounts.set(txn.accountId, placeholderAccount(txn.accountId, synthetic));
        const key = txnKey(txn.accountId, txn.id);
        const existing = ledger.txns.get(key);
        if (!existing) {
          ledger.txns.set(key, txn);
          introducedBy.set(key, i);
          counts.new++;
        } else if (existing.status === 'PENDING' && txn.status === 'POSTED') {
          // Same id, now posted: the posted record replaces the pending one.
          txn.importIds = [...new Set([...existing.importIds, importId])];
          ledger.txns.set(key, txn);
          counts.superseded++;
        } else {
          if (!existing.importIds.includes(importId)) existing.importIds.push(importId);
          counts.duplicate++;
        }
      }
    }
  }

  deriveLinks(ledger);

  // Attribute newly superseded pending records to the file that brought in the posted record.
  for (const t of ledger.txns.values()) {
    if (!t.supersededBy) continue;
    const key = txnKey(t.accountId, t.id);
    if (supersededBefore.has(key)) continue;
    const by = introducedBy.get(txnKey(t.accountId, t.supersededBy)) ?? introducedBy.get(key);
    if (by !== undefined) byIndex.get(by)!.counts.superseded++;
  }

  for (let i = 0; i < files.length; i++) results.push(byIndex.get(i)!);
  return results;
}

function kindRank(kind: CdrPayload['kind']): number {
  return kind === 'accounts' ? 0 : kind === 'transactions' ? 1 : 2;
}

const canonical = (a: Txn, b: Txn) =>
  a.date < b.date
    ? -1
    : a.date > b.date
      ? 1
      : a.accountId < b.accountId
        ? -1
        : a.accountId > b.accountId
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;

/**
 * Recompute pending → posted (FR-ING-005) and internal transfer pairs
 * (FR-ING-007) from scratch, in a canonical order.
 */
export function deriveLinks(ledger: Ledger): void {
  const all = [...ledger.txns.values()].sort(canonical);
  for (const t of all) {
    delete t.supersededBy;
    delete t.transferPairId;
  }

  // Pending → posted: same account and amount, posted within 7 days, similar description.
  const postedByAcctAmount = new Map<string, Txn[]>();
  for (const t of all) {
    if (t.status !== 'POSTED') continue;
    const k = `${t.accountId}\u001f${t.amount}`;
    const list = postedByAcctAmount.get(k) ?? [];
    list.push(t);
    postedByAcctAmount.set(k, list);
  }
  const usedPosted = new Set<Txn>();
  for (const p of all) {
    if (p.status !== 'PENDING') continue;
    const pDay = dayNumber(p.date);
    let best: { t: Txn; sim: number; gap: number } | null = null;
    for (const c of postedByAcctAmount.get(`${p.accountId}\u001f${p.amount}`) ?? []) {
      if (usedPosted.has(c)) continue;
      const gap = dayNumber(c.date) - pDay;
      if (gap < 0 || gap > PENDING_MATCH_DAYS) continue;
      const sim = Math.max(
        descriptionSimilarity(p.description, c.description),
        p.merchantName && c.merchantName ? descriptionSimilarity(p.merchantName, c.merchantName) : 0
      );
      if (sim < PENDING_SIMILARITY) continue;
      if (!best || sim > best.sim || (sim === best.sim && gap < best.gap))
        best = { t: c, sim, gap };
    }
    if (best) {
      usedPosted.add(best.t);
      p.supersededBy = best.t.id;
    }
  }

  // Internal transfers: equal and opposite, across two of the user's accounts, within 3 days.
  const owned = new Set(ledger.accounts.keys());
  const incoming = new Map<bigint, Txn[]>();
  for (const t of all) {
    if (t.status !== 'POSTED' || t.amount <= 0n || !owned.has(t.accountId)) continue;
    const list = incoming.get(t.amount) ?? [];
    list.push(t);
    incoming.set(t.amount, list);
  }
  const usedIn = new Set<Txn>();
  for (const out of all) {
    if (out.status !== 'POSTED' || out.amount >= 0n || !owned.has(out.accountId)) continue;
    const outDay = dayNumber(out.date);
    let best: { t: Txn; gap: number; score: number } | null = null;
    for (const c of incoming.get(-out.amount) ?? []) {
      if (usedIn.has(c) || c.accountId === out.accountId) continue;
      const gap = Math.abs(dayNumber(c.date) - outDay);
      if (gap > TRANSFER_MATCH_DAYS) continue;
      const score =
        (out.cdrType === 'TRANSFER_OUTGOING' ? 1 : 0) + (c.cdrType === 'TRANSFER_INCOMING' ? 1 : 0);
      if (!best || gap < best.gap || (gap === best.gap && score > best.score))
        best = { t: c, gap, score };
    }
    if (best) {
      usedIn.add(best.t);
      const pairId = `${out.accountId}/${out.id}~${best.t.accountId}/${best.t.id}`;
      out.transferPairId = pairId;
      best.t.transferPairId = pairId;
    }
  }
}

/** Should this record count as spending or income? Not when pending-superseded or an internal transfer. */
export function isEffective(t: Txn): boolean {
  return !t.supersededBy && !t.transferPairId;
}

export interface ReconcileGap {
  from: IsoDate;
  to: IsoDate;
  fromAt: string;
  toAt: string;
  /** Reported minus expected, in minor units. */
  drift: bigint;
}

export interface AccountReconciliation {
  accountId: string;
  checkpoints: number;
  intervals: number;
  gaps: ReconcileGap[];
}

/** The instant a posted record moved the balance. */
function txnInstant(t: Txn): number {
  const s = t.postedAt ?? t.valueAt ?? t.executedAt;
  return s ? Date.parse(s) : Date.parse(`${t.date}T12:00:00Z`);
}

/**
 * FR-REC-001: between consecutive balance checkpoints, the reported change
 * must equal the sum of posted transactions. A drift above AUD 1 marks an
 * import gap (missing pages) over that date range.
 */
export function reconcile(ledger: Ledger): AccountReconciliation[] {
  const byAccount = new Map<string, BalanceCheckpoint[]>();
  for (const b of ledger.balances.values()) {
    const list = byAccount.get(b.accountId) ?? [];
    list.push(b);
    byAccount.set(b.accountId, list);
  }
  const posted = new Map<string, { at: number; amount: bigint }[]>();
  for (const t of ledger.txns.values()) {
    if (t.status !== 'POSTED') continue;
    const list = posted.get(t.accountId) ?? [];
    list.push({ at: txnInstant(t), amount: t.amount });
    posted.set(t.accountId, list);
  }
  const out: AccountReconciliation[] = [];
  for (const accountId of [...ledger.accounts.keys()].sort()) {
    const cps = (byAccount.get(accountId) ?? []).sort(
      (a, b) => Date.parse(a.asAt) - Date.parse(b.asAt)
    );
    const flows = (posted.get(accountId) ?? []).sort((a, b) => a.at - b.at);
    const gaps: ReconcileGap[] = [];
    let j = 0;
    for (let i = 1; i < cps.length; i++) {
      const a = cps[i - 1]!;
      const b = cps[i]!;
      const from = Date.parse(a.asAt);
      const to = Date.parse(b.asAt);
      while (j < flows.length && flows[j]!.at <= from) j++;
      let sum = 0n;
      let k = j;
      while (k < flows.length && flows[k]!.at <= to) sum += flows[k++]!.amount;
      const drift = b.current - (a.current + sum);
      if (drift > RECONCILE_TOLERANCE || drift < -RECONCILE_TOLERANCE) {
        gaps.push({ from: a.date, to: b.date, fromAt: a.asAt, toAt: b.asAt, drift });
      }
    }
    out.push({ accountId, checkpoints: cps.length, intervals: Math.max(0, cps.length - 1), gaps });
  }
  return out;
}
