/**
 * Actual vs budget per category (FR-BUD-001): for a chosen period and tier,
 * the budget, actual (posted, excluding transfers and pending duplicates,
 * net of refunds), variance, and trailing 3/6/12-month run rates.
 */
import type { Txn } from '../domain/types.ts';
import { addDays, addMonths, daysInMonth, parseIsoDate, type IsoDate } from '../lib/dates.ts';
import { DEFAULT_PERIODS, perWeek, WEEKS_IN, type PeriodTable, type Span } from './periods.ts';
import { weeklyRate, type BudgetLine, type TierId } from './model.ts';

export interface Window {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

/** The week, calendar month or 12 months ending on (and including) `end`'s period. */
export function windowFor(span: Span, end: IsoDate): Window {
  const { y, m } = parseIsoDate(end);
  if (span === 'week') return { from: addDays(end, -6), to: end, label: `week to ${end}` };
  if (span === 'month') {
    const from = `${end.slice(0, 7)}-01`;
    return {
      from,
      to: `${end.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
      label: end.slice(0, 7),
    };
  }
  const to = `${end.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  return {
    from: addMonths(`${end.slice(0, 7)}-01`, -11),
    to,
    label: `12 months to ${end.slice(0, 7)}`,
  };
}

/** Spending kinds that a budget covers: operating spend, fees, interest charged, and refunds netting against them. */
function spendOf(t: Txn): bigint {
  const c = t.classification;
  if (!c || t.supersededBy || t.transferPairId) return 0n;
  if (
    c.kind === 'opex' ||
    c.kind === 'fee' ||
    c.kind === 'tax' ||
    (c.kind === 'interest' && t.amount < 0n) ||
    c.kind === 'refund'
  ) {
    return -t.amount;
  }
  return 0n;
}

function capexOf(t: Txn): bigint {
  const c = t.classification;
  if (!c || t.supersededBy || t.transferPairId) return 0n;
  return c.kind === 'capex' || (c.kind === 'refund' && c.categoryId.startsWith('capex.'))
    ? -t.amount
    : 0n;
}

export interface CategoryRow {
  categoryId: string;
  /** Minor units for the span (float: rates are fractional). */
  budget: number;
  actual: bigint;
  variance: number;
  /** Variance as a share of budget, null when there is no budget. */
  variancePct: number | null;
  runRate: { m3: number; m6: number; m12: number };
  txnCount: number;
  budgeted: boolean;
}

export interface ActualsReport {
  window: Window;
  span: Span;
  tier: TierId;
  rows: CategoryRow[];
  totals: { budget: number; actual: bigint; variance: number };
  capexActual: bigint;
}

export function actualVsBudget(
  txns: readonly Txn[],
  lines: readonly BudgetLine[],
  opts: { tier: TierId; span: Span; end: IsoDate; periods?: PeriodTable }
): ActualsReport {
  const periods = opts.periods ?? DEFAULT_PERIODS;
  const win = windowFor(opts.span, opts.end);
  const weeks = WEEKS_IN[opts.span];
  const budgetBy = new Map<string, number>();
  for (const l of lines)
    budgetBy.set(
      l.categoryId,
      (budgetBy.get(l.categoryId) ?? 0) +
        // A line that ended before the window counts as nothing (FR-BUD-005).
        weeklyRate(l, opts.tier, (c) => perWeek(c, periods), win.from) * weeks
    );

  const monthEnd = `${win.to.slice(0, 7)}-01`;
  const trailing = (n: number) => ({ from: addMonths(monthEnd, -(n - 1)), to: win.to });
  const t3 = trailing(3);
  const t6 = trailing(6);
  const t12 = trailing(12);
  const actual = new Map<string, bigint>();
  const counts = new Map<string, number>();
  const run = {
    m3: new Map<string, bigint>(),
    m6: new Map<string, bigint>(),
    m12: new Map<string, bigint>(),
  };
  let capexActual = 0n;
  for (const t of txns) {
    const cat = t.classification?.categoryId;
    if (!cat) continue;
    const s = spendOf(t);
    if (t.date >= win.from && t.date <= win.to) {
      capexActual += capexOf(t);
      if (s !== 0n) {
        actual.set(cat, (actual.get(cat) ?? 0n) + s);
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    if (s === 0n) continue;
    for (const [k, w] of [
      ['m3', t3],
      ['m6', t6],
      ['m12', t12],
    ] as const) {
      if (t.date >= w.from && t.date <= w.to) run[k].set(cat, (run[k].get(cat) ?? 0n) + s);
    }
  }
  const perSpan = (sum: bigint, months: number) =>
    (Number(sum) / months) * (weeks / WEEKS_IN.month);
  const ids = [...new Set([...budgetBy.keys(), ...actual.keys()])].sort();
  const rows: CategoryRow[] = ids.map((id) => {
    const budget = budgetBy.get(id) ?? 0;
    const a = actual.get(id) ?? 0n;
    const variance = budget - Number(a);
    return {
      categoryId: id,
      budget,
      actual: a,
      variance,
      variancePct: budget > 0 ? variance / budget : null,
      runRate: {
        m3: perSpan(run.m3.get(id) ?? 0n, 3),
        m6: perSpan(run.m6.get(id) ?? 0n, 6),
        m12: perSpan(run.m12.get(id) ?? 0n, 12),
      },
      txnCount: counts.get(id) ?? 0,
      budgeted: budgetBy.has(id),
    };
  });
  const totals = rows.reduce(
    (s, r) => ({
      budget: s.budget + r.budget,
      actual: s.actual + r.actual,
      variance: s.variance + r.variance,
    }),
    { budget: 0, actual: 0n, variance: 0 }
  );
  return { window: win, span: opts.span, tier: opts.tier, rows, totals, capexActual };
}

/** Month-end dates covered by the data, newest first, for the period picker. */
export function availableMonths(txns: readonly Txn[]): IsoDate[] {
  const months = new Set<string>();
  for (const t of txns) if (!t.supersededBy) months.add(t.date.slice(0, 7));
  return [...months]
    .sort()
    .reverse()
    .map((m) => {
      const { y, m: mo } = parseIsoDate(`${m}-01`);
      return `${m}-${String(daysInMonth(y, mo)).padStart(2, '0')}`;
    });
}
