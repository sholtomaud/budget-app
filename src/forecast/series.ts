/** Monthly spending series per category, from the ledger (SPEC §10.1). */
import type { Txn } from '../domain/types.ts';
import { addMonths, daysInMonth, parseIsoDate } from '../lib/dates.ts';

export interface MonthlySeries {
  categoryId: string;
  /** 'YYYY-MM' for each month, oldest first. */
  months: string[];
  /** Real spend per month in minor units (net of refunds). */
  values: number[];
}

/** Operating spend of a transaction: what a budget covers. Same rule as actual vs budget. */
export function spend(t: Txn): number {
  const c = t.classification;
  if (!c || t.supersededBy || t.transferPairId) return 0;
  if (
    c.kind === 'opex' ||
    c.kind === 'fee' ||
    c.kind === 'tax' ||
    (c.kind === 'interest' && t.amount < 0n) ||
    (c.kind === 'refund' && !c.categoryId.startsWith('capex.'))
  ) {
    return Number(-t.amount);
  }
  return 0;
}

/** The complete months covered by the data: a month counts if the data starts by its 3rd and runs to within 3 days of its end. */
export function coveredMonths(txns: readonly Txn[]): string[] {
  let min = '';
  let max = '';
  for (const t of txns) {
    if (t.supersededBy) continue;
    if (!min || t.date < min) min = t.date;
    if (!max || t.date > max) max = t.date;
  }
  if (!min) return [];
  let first = `${min.slice(0, 7)}-01`;
  if (parseIsoDate(min).d > 3) first = addMonths(first, 1);
  const { y, m, d } = parseIsoDate(max);
  let last = `${max.slice(0, 7)}-01`;
  if (d < daysInMonth(y, m) - 3) last = addMonths(last, -1);
  const out: string[] = [];
  for (let cur = first; cur <= last; cur = addMonths(cur, 1)) out.push(cur.slice(0, 7));
  return out;
}

export function monthlySeries(txns: readonly Txn[]): MonthlySeries[] {
  const months = coveredMonths(txns);
  const index = new Map(months.map((m, i) => [m, i]));
  const by = new Map<string, number[]>();
  for (const t of txns) {
    const s = spend(t);
    if (s === 0) continue;
    const i = index.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    const cat = t.classification!.categoryId;
    let arr = by.get(cat);
    if (!arr) {
      arr = new Array<number>(months.length).fill(0);
      by.set(cat, arr);
    }
    arr[i]! += s;
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([categoryId, values]) => ({ categoryId, months, values }));
}
