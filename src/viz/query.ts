/**
 * Runs a chart spec's queries on the device (FR-VIZ-002, ADR 0028): the
 * ledger and the budget in, a table of rounded-to-the-cent dollars out. Pure:
 * the same spec over the same data gives the same table.
 */
import type { BudgetLine } from '../budget/model.ts';
import { weeklyRate } from '../budget/model.ts';
import { perWeek, WEEKS_IN, type PeriodTable } from '../budget/periods.ts';
import { categoryName, type Category } from '../classify/categories.ts';
import type { Txn } from '../domain/types.ts';
import { coveredMonths, spend } from '../forecast/series.ts';
import { isTime, type ChartSpec, type GroupBy, type SeriesSpec } from './spec.ts';

export interface QueryContext {
  txns: readonly Txn[];
  categories: readonly Category[];
  lines: readonly BudgetLine[];
  periods: PeriodTable;
  /** The budget tier to use: the plan's. */
  tier: string;
  /** Savings over time from the latest full run (ADR 0032), for the capital dataset. */
  capital?: CapitalPath;
}

export type QuantileRole = 'p5' | 'p25' | 'p50' | 'p75' | 'p95';

/** Capital in today's dollars, a point a year: months from `asOf`, and quantiles. */
export interface CapitalPath {
  asOf: string;
  months: number[];
  q: Record<QuantileRole, number[]>;
  floor: number;
  /** When freedom starts, YYYY-MM. */
  start: string;
}

export type Provenance = 'actual' | 'budgeted' | 'forecast';

export interface TableSeries {
  label: string;
  values: number[];
  unit: 'dollars' | 'count';
  provenance: Provenance;
  /** For a fan: which quantile of the simulated futures this series is. */
  role?: QuantileRole;
}

export interface ChartTable {
  /** Keys along the x axis: 'YYYY-MM', 'YYYY-Qn', 'YYYY', a category or group id, a merchant. */
  x: string[];
  /** The same, in words. */
  labels: string[];
  series: TableSeries[];
  /** The months the data covers, first and last ('YYYY-MM'). */
  window: { from: string; to: string } | null;
  /** Category and merchant axes show monthly averages over the window. */
  perMonth: boolean;
  /** A line the values should stay above (the plan's floor), dollars. */
  floor?: number;
  /** Series left out because nothing matched them, in words. */
  notes: string[];
}

export type ChartResult = { ok: true; table: ChartTable } | { ok: false; error: string };

/** Category and merchant axes keep the biggest few; the rest is one bar. */
export const MAX_BARS = 12;
const OTHER = '(other)';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bucket(month: string, g: GroupBy): string {
  if (g === 'year') return month.slice(0, 4);
  if (g === 'quarter')
    return `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
  return month;
}

function bucketLabel(key: string, g: GroupBy): string {
  if (g === 'year') return key;
  if (g === 'quarter') return `${key.slice(5)} ${key.slice(0, 4)}`;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

const groupOf = (categoryId: string) => categoryId.split('.')[0] ?? categoryId;

const inCategories = (id: string, cats: readonly string[] | undefined) =>
  !cats?.length || cats.some((c) => id === c || id.startsWith(`${c}.`));

const textMatch = (s: string | undefined, text: string | undefined) =>
  !text || (s ?? '').toLowerCase().includes(text.toLowerCase());

/** The months a series covers: its own range, or the last N, or all the data. */
function seriesMonths(s: SeriesSpec, all: readonly string[]): string[] {
  const f = s.filter;
  if (f?.from || f?.to) return all.filter((m) => (!f.from || m >= f.from) && (!f.to || m <= f.to));
  if (f?.lastMonths) return all.slice(-f.lastMonths);
  return [...all];
}

interface Row {
  month: string;
  key: string;
  value: number;
}

/** One series as rows: month, axis key and value (minor units, or 1 per transaction for count). */
function rows(s: SeriesSpec, g: GroupBy, months: readonly string[], ctx: QueryContext): Row[] {
  const out: Row[] = [];
  const keep = new Set(months);
  const count = s.measure === 'count';
  const f = s.filter;
  if (s.dataset === 'budget') {
    const per = (code: string) => perWeek(code, ctx.periods);
    for (const l of ctx.lines) {
      if (!inCategories(l.categoryId, f?.categories) || !textMatch(l.item, f?.text)) continue;
      const monthly = weeklyRate(l, ctx.tier, per) * WEEKS_IN.month;
      if (!monthly) continue;
      const key = g === 'group' ? groupOf(l.categoryId) : g === 'category' ? l.categoryId : '';
      for (const m of months)
        out.push({ month: m, key: isTime(g) ? bucket(m, g) : key, value: monthly });
    }
    return out;
  }
  for (const t of ctx.txns) {
    const month = t.date.slice(0, 7);
    if (!keep.has(month)) continue;
    const c = t.classification;
    if (!c) continue;
    let v = 0;
    if (s.dataset === 'spending') v = spend(t);
    else if (c.kind === 'income' && !t.supersededBy && !t.transferPairId) v = Number(t.amount);
    if (!v) continue;
    if (!inCategories(c.categoryId, f?.categories)) continue;
    const merchant = t.merchantName || t.description;
    if (!textMatch(merchant, f?.text) && !textMatch(t.description, f?.text)) continue;
    const key = isTime(g)
      ? bucket(month, g)
      : g === 'group'
        ? groupOf(c.categoryId)
        : g === 'category'
          ? c.categoryId
          : merchant.trim().replace(/\s+/g, ' ').slice(0, 40) || '(no name)';
    out.push({ month, key, value: count ? 1 : v });
  }
  return out;
}

const ROLE_LABEL: Record<QuantileRole, string> = {
  p5: 'Bad case (1 in 20)',
  p25: 'Lower (1 in 4)',
  p50: 'Typical',
  p75: 'Upper (1 in 4)',
  p95: 'Good case (1 in 20)',
};

/** Savings over time: one point a year from the latest full run. */
function capitalChart(spec: ChartSpec, c: CapitalPath | undefined): ChartResult {
  if (!c)
    return {
      ok: false,
      error:
        'There is no full run of your plan yet. Run it (Freedom, Run my plan, or ask me to "run my plan") and I can chart your savings over time.',
    };
  const year0 = Number(c.asOf.slice(0, 4));
  const startAt = Math.max(0, Number(c.start.slice(0, 4)) - year0);
  const roles: QuantileRole[] =
    spec.kind === 'line' ? ['p5', 'p50', 'p95'] : ['p5', 'p25', 'p50', 'p75', 'p95'];
  const x = c.months.map((m) => String(year0 + Math.round(m / 12)));
  return {
    ok: true,
    table: {
      x,
      labels: x.map((y, i) => (i === startAt ? `${y} (freedom)` : y)),
      series: roles.map((r) => ({
        label: ROLE_LABEL[r],
        values: c.q[r].map((v) => Math.round(v)),
        unit: 'dollars',
        provenance: 'forecast',
        role: r,
      })),
      window: { from: c.asOf, to: `${x[x.length - 1]}-12` },
      perMonth: false,
      notes: [],
      floor: c.floor,
    },
  };
}

export function runChart(spec: ChartSpec, ctx: QueryContext): ChartResult {
  if (spec.series.some((s) => s.dataset === 'capital')) return capitalChart(spec, ctx.capital);
  const all = coveredMonths(ctx.txns);
  const hasBudget = spec.series.some((s) => s.dataset === 'budget');
  if (!all.length && !hasBudget)
    return { ok: false, error: 'There are no complete months of transactions to chart yet.' };
  // A budget on its own still needs months to sit in: the last 12, ending this month.
  const months = all.length ? all : lastYear();
  const g = spec.groupBy;
  const notes: string[] = [];
  // A series nothing matches would draw as a flat zero, which reads as "you spent nothing".
  const perSeries = spec.series
    .map((s) => {
      const ms = seriesMonths(s, months);
      return { s, ms, rows: rows(s, g, ms, ctx) };
    })
    .filter((p) => {
      if (p.rows.length) return true;
      notes.push(
        p.s.dataset === 'budget'
          ? `${p.s.label}: there is no budget for this yet, so it isn't shown.`
          : `${p.s.label}: nothing matches it, so it isn't shown.`
      );
      return false;
    });
  if (!perSeries.length)
    return {
      ok: false,
      error: `Nothing matches that chart. ${notes.join(' ')}`.trim(),
    };

  let x: string[];
  if (isTime(g)) {
    const used = new Set(perSeries.flatMap((p) => p.ms.map((m) => bucket(m, g))));
    x = [...used].sort();
  } else {
    // Biggest first by the first series; the rest folded into one bar.
    const totals = new Map<string, number>();
    for (const p of perSeries)
      for (const r of p.rows) totals.set(r.key, (totals.get(r.key) ?? 0) + Math.abs(r.value));
    x = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
    if (x.length > MAX_BARS) x = [...x.slice(0, MAX_BARS - 1), OTHER];
  }
  if (!x.length)
    return {
      ok: false,
      error: 'Nothing matches that chart: no transactions or budget lines in it.',
    };
  const index = new Map(x.map((k, i) => [k, i]));
  const otherAt = index.get(OTHER);

  const series: TableSeries[] = perSeries.map(({ s, ms, rows }) => {
    const values = new Array<number>(x.length).fill(0);
    for (const r of rows) {
      const i = index.get(r.key) ?? otherAt;
      if (i !== undefined) values[i]! += r.value;
    }
    const count = s.measure === 'count';
    const divide = isTime(g) ? 1 : Math.max(1, ms.length);
    return {
      label: s.label,
      values: values.map((v) => {
        const per = v / divide;
        return count ? Math.round(per * 10) / 10 : Math.round(per) / 100;
      }),
      unit: count ? 'count' : 'dollars',
      provenance: s.dataset === 'budget' ? 'budgeted' : 'actual',
    };
  });

  const used = perSeries.flatMap((p) => p.ms).sort();
  return {
    ok: true,
    table: {
      x,
      labels: x.map((k) =>
        isTime(g)
          ? bucketLabel(k, g)
          : k === OTHER
            ? 'Everything else'
            : g === 'merchant'
              ? k
              : categoryName(k, ctx.categories)
      ),
      series,
      window: used.length ? { from: used[0]!, to: used[used.length - 1]! } : null,
      perMonth: !isTime(g),
      notes,
    },
  };
}

function lastYear(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** The table as CSV: one row per x value, one column per series (FR-VIZ-006). */
export function tableCsv(t: ChartTable): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // A cell that starts with = + - @ would run as a formula in a spreadsheet.
  const safe = (s: string) => q(/^[=+\-@]/.test(s) ? `'${s}` : s);
  const head = [
    '',
    ...t.series.map(
      (s) =>
        `${s.label} (${s.unit === 'count' ? 'count' : 'AUD'}${t.perMonth ? ' a month' : ''}, ${s.provenance})`
    ),
  ];
  const body = t.labels.map((l, i) => [safe(l), ...t.series.map((s) => String(s.values[i] ?? ''))]);
  return [head.map(safe), ...body].map((r) => r.join(',')).join('\n') + '\n';
}
