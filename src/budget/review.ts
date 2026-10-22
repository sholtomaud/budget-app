/**
 * The budget review (ADR 0038): a feedback loop over the budget. Per
 * category, the last three months' spending against the budget; a deadband
 * so noise moves nothing; a gain so the budget converges instead of
 * oscillating; hysteresis so a category isn't moved twice in a row; and
 * the floor's rule: essential (Secure) lines only ever go up. Pure: data in,
 * findings out. It never changes the budget; the app turns findings into
 * cards the person applies.
 */
import type { Txn } from '../domain/types.ts';
import { monthlySeries } from '../forecast/series.ts';
import { weeklyRate, type BudgetLine, type Tier } from './model.ts';
import { perWeek, type PeriodTable } from './periods.ts';

/** How far a proposal moves the budget towards what it costs. */
export const GAIN = 0.5;
/** Months of spending a category needs before it is reviewed. */
export const MIN_MONTHS = 6;
/** A category changed this many months ago or less is left alone. */
export const HOLD_MONTHS = 2;
/** At most this many changes are proposed in one review, largest first. */
export const MAX_PROPOSALS = 5;
/** Proposals are rounded to this, a month (minor units: $10). */
const ROUND_TO = 1000;

const WEEKS_PER_MONTH = 52 / 12;

export interface Band {
  /** Monthly spending, minor units: below `lo` or above `hi` is more than noise. */
  lo: number;
  hi: number;
  source: 'model' | 'history';
}

export interface ReviewLogEntry {
  categoryId: string;
  /** The review month, 'YYYY-MM'. */
  month: string;
  /** Monthly budget before and after, minor units. */
  from: number;
  to: number;
}

export type FindingKind =
  /** An essential category costs more than its budget: raise it. */
  | 'raise'
  /** A discretionary category costs more: raise it, take it from another, or keep the budget. */
  | 'choice'
  /** A discretionary category costs less: lower it. */
  | 'lower'
  /** An essential category has cost less for six months: said, not proposed. */
  | 'under';

export interface Finding {
  categoryId: string;
  kind: FindingKind;
  /** Monthly, minor units. */
  budget: number;
  runRate: number;
  band: Band;
  /** The proposed monthly budget (not for 'under'). */
  proposed: number;
  essential: boolean;
}

export interface Skipped {
  categoryId: string;
  why: 'new' | 'recent';
}

export interface Review {
  /** The last complete month reviewed, 'YYYY-MM'. */
  month: string | null;
  findings: Finding[];
  skipped: Skipped[];
  /** Categories inside their band: nothing to do. */
  steady: string[];
}

export interface ReviewInput {
  lines: readonly BudgetLine[];
  txns: readonly Txn[];
  periods: PeriodTable;
  /** The plan's tier: the budget being reviewed. */
  tier: string;
  /** In order; the first is the floor (Secure). */
  tiers: readonly Tier[];
  log: readonly ReviewLogEntry[];
  /** The forecast model's 80 % monthly range per category, when it has one. */
  modelBands?: Readonly<Record<string, { lo: number; hi: number }>>;
}

const groupOf = (id: string) => id.split('.')[0] ?? id;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * How much a category's month moves by itself, from the month-to-month
 * changes: the median absolute change, scaled to a standard deviation
 * (1.4826 × MAD, / √2 for a difference). A step change (rent going up) is
 * one big difference among many small ones, so it doesn't widen the band.
 */
function monthlyNoise(xs: readonly number[]): number {
  const d = xs.slice(1).map((x, i) => x - xs[i]!);
  if (!d.length) return 0;
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const c = med(d);
  return (1.4826 * med(d.map((x) => Math.abs(x - c)))) / Math.SQRT2;
}

/** 80 % of a normal falls within ±1.2816 standard deviations. */
const Z80 = 1.2816;

const monthsApart = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
  Number(b.slice(5, 7)) -
  Number(a.slice(5, 7));

/** The budget for a category a month at a tier, minor units. */
export function monthlyBudget(
  lines: readonly BudgetLine[],
  tier: string,
  periods: PeriodTable,
  month = new Date().toISOString().slice(0, 7)
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (groupOf(l.categoryId) === 'capex') continue;
    const m = weeklyRate(l, tier, (c) => perWeek(c, periods), month) * WEEKS_PER_MONTH;
    if (m > 0) out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + m);
  }
  return out;
}

/** A line the floor tier includes: an essential, which only goes up. */
export const isEssentialLine = (l: BudgetLine, floorTier: string) =>
  (l.tierMultiplier[floorTier] ?? 1) > 0;

export function reviewBudget(input: ReviewInput): Review {
  const series = monthlySeries(input.txns);
  const months = series[0]?.months ?? [];
  const month = months.at(-1) ?? null;
  const budgets = monthlyBudget(input.lines, input.tier, input.periods);
  const floor = input.tiers[0]?.id ?? input.tier;
  const findings: Finding[] = [];
  const skipped: Skipped[] = [];
  const steady: string[] = [];
  const byCat = new Map(series.map((s) => [s.categoryId, s.values]));

  for (const [categoryId, budget] of [...budgets.entries()].sort()) {
    const all = byCat.get(categoryId) ?? [];
    const first = all.findIndex((x) => x > 0);
    const values = first < 0 ? [] : all.slice(first);
    // New: not enough history to tell a trend from noise (and nothing at all is new too).
    if (values.length < MIN_MONTHS) {
      skipped.push({ categoryId, why: 'new' });
      continue;
    }
    if (
      month &&
      input.log.some(
        (e) => e.categoryId === categoryId && monthsApart(e.month, month) <= HOLD_MONTHS
      )
    ) {
      skipped.push({ categoryId, why: 'recent' });
      continue;
    }
    const runRate = mean(values.slice(-3));
    const model = input.modelBands?.[categoryId];
    // Without the model's range: the recent level, give or take a month's usual movement.
    const noise = monthlyNoise(values.slice(-12));
    const band: Band = model
      ? { ...model, source: 'model' }
      : { lo: runRate - Z80 * noise, hi: runRate + Z80 * noise, source: 'history' };
    const essential = input.lines.some(
      (l) => l.categoryId === categoryId && isEssentialLine(l, floor)
    );
    const step = (target: number) =>
      Math.round((budget + GAIN * (target - budget)) / ROUND_TO) * ROUND_TO;
    const big = (proposed: number) => Math.abs(proposed - budget) >= Math.max(500, 0.02 * budget);

    if (budget < band.lo && runRate > budget) {
      // Spending is reliably above the budget.
      const proposed = step(runRate);
      if (big(proposed))
        findings.push({
          categoryId,
          kind: essential ? 'raise' : 'choice',
          budget,
          runRate,
          band,
          proposed,
          essential,
        });
      else steady.push(categoryId);
    } else if (budget > band.hi && runRate < budget) {
      if (essential) {
        // Essentials are never cut to fit a plan; six months under is worth saying.
        if (mean(values.slice(-6)) < budget * 0.85)
          findings.push({
            categoryId,
            kind: 'under',
            budget,
            runRate,
            band,
            proposed: budget,
            essential,
          });
        else steady.push(categoryId);
        continue;
      }
      const proposed = step(runRate);
      if (big(proposed))
        findings.push({ categoryId, kind: 'lower', budget, runRate, band, proposed, essential });
      else steady.push(categoryId);
    } else steady.push(categoryId);
  }
  // Largest change first; notes after proposals.
  findings.sort(
    (a, b) =>
      Number(a.kind === 'under') - Number(b.kind === 'under') ||
      Math.abs(b.proposed - b.budget) - Math.abs(a.proposed - a.budget)
  );
  const proposals = findings.filter((f) => f.kind !== 'under').slice(0, MAX_PROPOSALS);
  return {
    month,
    findings: [...proposals, ...findings.filter((f) => f.kind === 'under')],
    skipped,
    steady,
  };
}

/**
 * The lines of a category scaled so its monthly budget becomes `to`: every
 * line keeps its share, period and tier multipliers. Costs to the dollar.
 */
export function scaleCategory(
  lines: readonly BudgetLine[],
  categoryId: string,
  from: number,
  to: number
): { before: BudgetLine[]; after: BudgetLine[] } {
  const before = lines.filter((l) => l.categoryId === categoryId);
  const f = from > 0 ? to / from : 1;
  const after = before.map((l) => ({
    ...l,
    cost: BigInt(Math.round((Number(l.cost) * f) / 100) * 100),
  }));
  return { before, after };
}

/**
 * For a discretionary category over its budget: another discretionary one
 * reliably under its own, to take the difference from. The one with the most
 * room, or none.
 */
export function donorFor(f: Finding, review: Review): { categoryId: string; room: number } | null {
  const need = f.proposed - f.budget;
  const lowered = review.findings.filter(
    (x) => x.kind === 'lower' && x.categoryId !== f.categoryId
  );
  const best = lowered
    .map((x) => ({ categoryId: x.categoryId, room: x.budget - x.runRate }))
    .filter((x) => x.room >= need)
    .sort((a, b) => b.room - a.room)[0];
  return best ?? null;
}
