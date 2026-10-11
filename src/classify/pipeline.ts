/**
 * The classification pipeline (SPEC §8). First confident answer wins:
 *
 *   1. structural   CDR type, transfer pairs, refunds (FR-CLS-003)
 *   2. user rules   ordered, confidence 1
 *   3. memory       remembered corrections, confidence 0.95
 *   4. MCC map      merchant category code, confidence 0.8
 *   5. model        naive Bayes on the user's corrections
 *   6. (LLM, M8)
 *   7. unclassified → review queue
 *
 * A user's own label is never overwritten (FR-CLS-004). Debits are proposed
 * as CAPEX when their category is capital, or when they are large outliers
 * for their category (FR-CLS-002).
 */
import type { Classification, ClassificationKind, Txn } from '../domain/types.ts';
import { txnKey } from '../ingest/ids.ts';
import { descriptionSimilarity } from '../ingest/similarity.ts';
import { dayNumber } from '../lib/dates.ts';
import { kindOfCategory, UNCATEGORISED, type Category } from './categories.ts';
import { mccCategory, MCC_CONFIDENCE, type MccEntry } from './mcc.ts';
import { MEMORY_CONFIDENCE, recall, type MemoryEntry } from './memory.ts';
import { features, MODEL_VERSION, predict, train, type NbModel } from './model.ts';
import { firstRule, type Rule } from './rules.ts';

export const REVIEW_THRESHOLD = 0.6;
export const REFUND_WINDOW_DAYS = 60;
export const CAPEX_OUTLIER_FACTOR = 4n;
export const CAPEX_MIN = 20000n; // AUD 200

export interface UserLabel {
  categoryId: string;
  /** Overrides the kind the category implies (e.g. confirming or rejecting a CAPEX proposal). */
  kind?: ClassificationKind;
}

export interface ClassifyInput {
  categories: readonly Category[];
  rules: readonly Rule[];
  memory: ReadonlyMap<string, MemoryEntry>;
  userLabels: ReadonlyMap<string, UserLabel>;
  mccOverrides?: Record<string, MccEntry>;
}

export interface ClassifyResult {
  byKey: Map<string, Classification>;
  /** Refund → the purchase it reverses (FR-CLS-003). */
  refundOf: Map<string, string>;
  /** Debits proposed as CAPEX and not yet decided by the user (FR-CLS-002). */
  capexProposals: string[];
  model: NbModel | null;
}

const isEffective = (t: Txn) => !t.supersededBy;

/** Pair refunds with their original purchases: same account, equal amount, within 60 days, similar merchant. */
export function linkRefunds(txns: readonly Txn[]): Map<string, string> {
  const out = new Map<string, string>();
  const debits = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!isEffective(t) || t.transferPairId || t.amount >= 0n) continue;
    const k = `${t.accountId}|${-t.amount}`;
    const list = debits.get(k) ?? [];
    list.push(t);
    debits.set(k, list);
  }
  const used = new Set<Txn>();
  const credits = txns
    .filter(
      (t) =>
        isEffective(t) &&
        !t.transferPairId &&
        t.amount > 0n &&
        t.cdrType !== 'INTEREST_PAID' &&
        t.cdrType !== 'TRANSFER_INCOMING'
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  for (const c of credits) {
    const cDay = dayNumber(c.date);
    let best: { t: Txn; sim: number; gap: number } | null = null;
    for (const d of debits.get(`${c.accountId}|${c.amount}`) ?? []) {
      if (used.has(d)) continue;
      const gap = cDay - dayNumber(d.date);
      if (gap < 0 || gap > REFUND_WINDOW_DAYS) continue;
      const sim = Math.max(
        descriptionSimilarity(c.description.replace(/^REFUND\s+/i, ''), d.description),
        c.merchantName && d.merchantName ? descriptionSimilarity(c.merchantName, d.merchantName) : 0
      );
      if (sim < 0.5) continue;
      if (!best || sim > best.sim || (sim === best.sim && gap < best.gap))
        best = { t: d, sim, gap };
    }
    if (best) {
      used.add(best.t);
      out.set(txnKey(c.accountId, c.id), txnKey(best.t.accountId, best.t.id));
    }
  }
  return out;
}

function structural(t: Txn): Classification | null {
  if (t.transferPairId)
    return { kind: 'transfer', categoryId: 'transfer.internal', confidence: 1, by: 'structural' };
  switch (t.cdrType) {
    case 'INTEREST_PAID':
      return { kind: 'interest', categoryId: 'income.interest', confidence: 1, by: 'structural' };
    case 'INTEREST_CHARGED':
      return { kind: 'interest', categoryId: 'fees.interest', confidence: 1, by: 'structural' };
    case 'FEE':
      return { kind: 'fee', categoryId: 'fees.bank', confidence: 1, by: 'structural' };
  }
  return null;
}

/** Training data: the user's own labels, excluding structural cases. */
export function trainingSamples(txns: readonly Txn[], userLabels: ReadonlyMap<string, UserLabel>) {
  const samples: { x: number[]; y: string }[] = [];
  for (const t of txns) {
    const l = userLabels.get(txnKey(t.accountId, t.id));
    if (l && !structural(t)) samples.push({ x: features(t), y: l.categoryId });
  }
  return samples;
}

export function classifyAll(txns: readonly Txn[], input: ClassifyInput): ClassifyResult {
  const byKey = new Map<string, Classification>();
  const refundOf = linkRefunds(txns);
  const model = train(trainingSamples(txns, input.userLabels));
  const kindOf = (categoryId: string) => kindOfCategory(categoryId, input.categories);

  // Pass 1: everything except refunds, which take their original's category.
  for (const t of txns) {
    const key = txnKey(t.accountId, t.id);
    const user = input.userLabels.get(key);
    let c: Classification | null = null;
    if (user) {
      c = {
        kind: user.kind ?? kindOf(user.categoryId),
        categoryId: user.categoryId,
        confidence: 1,
        by: 'user',
      };
    } else if ((c = structural(t))) {
      // done
    } else if (refundOf.has(key)) {
      continue;
    } else {
      const rule = firstRule(input.rules, t);
      if (rule)
        c = {
          kind: kindOf(rule.categoryId),
          categoryId: rule.categoryId,
          confidence: 1,
          by: 'rule',
          ruleId: rule.id,
        };
      else {
        let mem = recall(input.memory, t);
        // A remembered capital merchant only applies to capital-sized purchases.
        if (mem && kindOf(mem.categoryId) === 'capex' && -t.amount < CAPEX_MIN) mem = undefined;
        if (mem)
          c = {
            kind: kindOf(mem.categoryId),
            categoryId: mem.categoryId,
            confidence: MEMORY_CONFIDENCE,
            by: 'memory',
          };
        else {
          const mcc = mccCategory(t, input.mccOverrides);
          if (mcc)
            c = { kind: kindOf(mcc), categoryId: mcc, confidence: MCC_CONFIDENCE, by: 'mcc' };
          else if (model) {
            const p = predict(model, features(t));
            c = {
              kind: kindOf(p.label),
              categoryId: p.label,
              confidence: p.p,
              by: 'model',
              modelVersion: MODEL_VERSION,
            };
          }
        }
      }
    }
    if (!c)
      c = {
        kind: t.amount >= 0n ? 'income' : 'opex',
        categoryId: UNCATEGORISED,
        confidence: 0,
        by: 'model',
      };
    // Money in can't be a purchase: a capital or investment category on a credit is income or a refund.
    if (
      t.amount > 0n &&
      (c.kind === 'capex' || c.kind === 'opex') &&
      c.by !== 'user' &&
      c.categoryId !== UNCATEGORISED
    ) {
      c = { ...c, kind: 'refund' };
    }
    byKey.set(key, c);
  }

  // Pass 2: refunds net against their originals (FR-CLS-003).
  for (const t of txns) {
    const key = txnKey(t.accountId, t.id);
    if (byKey.has(key)) continue;
    const orig = byKey.get(refundOf.get(key) ?? '');
    byKey.set(key, {
      kind: 'refund',
      categoryId: orig?.categoryId ?? UNCATEGORISED,
      ...(orig?.assetId ? { assetId: orig.assetId } : {}),
      confidence: orig ? Math.min(orig.confidence, 0.95) : 0,
      by: 'structural',
    });
  }

  // CAPEX proposals: capital categories, plus large outliers for their category (FR-CLS-002).
  const medians = categoryMedians(txns, byKey);
  const capexProposals: string[] = [];
  for (const t of txns) {
    if (!isEffective(t) || t.amount >= 0n) continue;
    const key = txnKey(t.accountId, t.id);
    const c = byKey.get(key)!;
    if (
      c.by === 'user' ||
      c.kind === 'transfer' ||
      c.kind === 'investment' ||
      c.kind === 'fee' ||
      c.kind === 'tax'
    )
      continue;
    const abs = -t.amount;
    const median = medians.get(c.categoryId);
    const outlier =
      c.kind === 'opex' &&
      median !== undefined &&
      abs >= CAPEX_MIN &&
      abs > median * CAPEX_OUTLIER_FACTOR;
    if (c.kind === 'capex' || outlier) {
      if (outlier) byKey.set(key, { ...c, kind: 'capex' });
      capexProposals.push(key);
    }
  }

  return { byKey, refundOf, capexProposals, model };
}

function categoryMedians(
  txns: readonly Txn[],
  byKey: Map<string, Classification>
): Map<string, bigint> {
  const groups = new Map<string, bigint[]>();
  for (const t of txns) {
    if (!isEffective(t) || t.amount >= 0n) continue;
    const c = byKey.get(txnKey(t.accountId, t.id));
    if (!c || c.categoryId === UNCATEGORISED) continue;
    const list = groups.get(c.categoryId) ?? [];
    list.push(-t.amount);
    groups.set(c.categoryId, list);
  }
  const out = new Map<string, bigint>();
  for (const [k, v] of groups) {
    if (v.length < 5) continue;
    v.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.set(k, v[Math.floor(v.length / 2)]!);
  }
  return out;
}

/** Needs a person: unclassified or below the confidence threshold. */
export function needsReview(c: Classification | undefined): boolean {
  return !c || c.categoryId === UNCATEGORISED || c.confidence < REVIEW_THRESHOLD;
}
