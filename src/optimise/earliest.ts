/**
 * The earliest freedom date (FR-OPT-001, ADR 0031): "what's the earliest I
 * can stop work?" answered by a search, not by trying dates one at a time.
 *
 * Starting later never makes a plan less likely to work while pay comes in,
 * so the chance of success is (near enough) monotone in the start date. The
 * search bisects over start dates on a grid of `stepMonths`, evaluating each
 * candidate on the same simulated futures (common random numbers, ADR 0013),
 * so it needs about log2(grid) simulations instead of one per date. The
 * answer is always a date that was simulated and reached the target.
 *
 * Three plans come back, so the person has real choices: the earliest date
 * at their target, the earliest with a safer margin, and the earliest if
 * they spend a little less after freedom.
 */
import { monthsBetween } from '../sim/modelgen.ts';
import type { FreedomSetup } from '../sim/inputs.ts';
import { applyLevers, baseValues } from './levers.ts';
import type { Evaluation } from './optimiser.ts';

export type EarliestPlanId = 'target' | 'safer' | 'spend-less';

export interface EarliestPlan {
  id: EarliestPlanId;
  /** The chance this plan is held to. */
  target: number;
  /** Months from the current start (negative is sooner). */
  months: number;
  /** When freedom starts, YYYY-MM. */
  start: string;
  /** Spending after freedom, as a multiplier on the tier. */
  tierSpend: number;
  pSuccess: number;
  runId: string;
  setup: FreedomSetup;
}

export interface EarliestRequest {
  setup: FreedomSetup;
  target: number;
  /** The soonest freedom could start, YYYY-MM (the simulation's first month: now). */
  soonest: string;
  /** How much later than the current start to look, in years. Default 10. */
  laterYears?: number;
  /** Grid resolution in months. Default 3. */
  stepMonths?: number;
  /** The margin above the target for the safer plan. Default 0.05. */
  margin?: number;
  /** Spending after freedom in the third plan, as a share of today's lever. Default 0.9. */
  spendLess?: number;
  /**
   * The smallest spending-after-freedom lever that pays for the essentials
   * (ADR 0033). No plan goes below it; a setup below it is searched at it.
   */
  minTierSpend?: number;
}

export interface EarliestResult {
  target: number;
  /** The current plan, for comparison. */
  current: { start: string; pSuccess: number; runId: string };
  /** Up to three plans; a plan is missing when no date in range reached its target. */
  plans: EarliestPlan[];
  /** The latest date tried and its chance, when even that missed the target. */
  latest?: { start: string; pSuccess: number; runId: string };
  /** Distinct simulations run. */
  simulations: number;
}

export interface EarliestDeps {
  evaluate(setup: FreedomSetup): Promise<Evaluation>;
  onProgress?(done: number): void;
}

const ym = (s: FreedomSetup) => s.goal.start.slice(0, 7);

export async function earliestFreedom(
  req: EarliestRequest,
  deps: EarliestDeps
): Promise<EarliestResult> {
  const { setup, target } = req;
  const step = Math.max(1, Math.round(req.stepMonths ?? 3));
  const lo = Math.min(0, monthsBetween(ym(setup), req.soonest.slice(0, 7)));
  const hi = Math.round((req.laterYears ?? 10) * 12);
  // Grid of month offsets from the current start: soonest, every `step`, the current start, the latest.
  const grid = [...new Set([lo, ...range(lo, hi, step), 0, hi])].sort((a, b) => a - b);
  const floor = req.minTierSpend ?? 0;
  // A plan that can't pay for the essentials is no plan: search at the floor at least.
  const baseSpend = Math.max(baseValues(setup).tierSpend, floor);

  const cache = new Map<string, { e: Evaluation; s: FreedomSetup }>();
  const at = async (months: number, tierSpend: number) => {
    const key = `${months}|${tierSpend}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const s = applyLevers(setup, { start: months / 12, tierSpend });
    const r = { e: await deps.evaluate(s), s };
    cache.set(key, r);
    deps.onProgress?.(cache.size);
    return r;
  };

  /**
   * The first grid index whose plan reaches `goal`, searching [from, to].
   * Indices below `from` are known to miss; null when even `to` misses.
   */
  const bisect = async (goal: number, tierSpend: number, from: number, to: number) => {
    const ok = async (i: number) => (await at(grid[i]!, tierSpend)).e.pSuccess >= goal;
    if (!(await ok(to))) return null;
    if (await ok(from)) return from;
    let bad = from;
    let good = to;
    while (good - bad > 1) {
      const mid = (bad + good) >> 1;
      if (await ok(mid)) good = mid;
      else bad = mid;
    }
    return good;
  };

  const now = grid.indexOf(0);
  const last = grid.length - 1;
  const current = (await at(0, baseSpend)).e;
  const plan = async (id: EarliestPlanId, goal: number, tierSpend: number, i: number | null) => {
    if (i === null) return [];
    const { e, s } = await at(grid[i]!, tierSpend);
    return [
      { id, target: goal, months: grid[i]!, start: ym(s), tierSpend, ...e, setup: s },
    ] satisfies EarliestPlan[];
  };

  // At the target: if today's start already works, look no later than it.
  const iTarget = current.pSuccess >= target ? await bisect(target, baseSpend, 0, now) : null;
  const first = iTarget ?? (await bisect(target, baseSpend, now, last));
  // A safer margin can only come later; spending less can only make it sooner.
  const safer = Math.min(0.99, Math.round((target + (req.margin ?? 0.05)) * 1000) / 1000);
  const iSafer = safer > target ? await bisect(safer, baseSpend, first ?? now, last) : null;
  const less = Math.max(floor, Math.round(baseSpend * (req.spendLess ?? 0.9) * 1000) / 1000);
  // Spending less is no plan when the essentials already set the floor.
  const iLess = less < baseSpend ? await bisect(target, less, 0, first ?? last) : null;

  // A plan on the same date as the first is no alternative.
  const differs = (i: number | null) => (i !== null && i !== first ? i : null);
  const plans = [
    ...(await plan('target', target, baseSpend, first)),
    ...(await plan('safer', safer, baseSpend, differs(iSafer))),
    ...(await plan('spend-less', target, less, differs(iLess))),
  ];
  const latest = first === null ? (await at(grid[last]!, baseSpend)).e : undefined;
  return {
    target,
    current: { start: ym(setup), pSuccess: current.pSuccess, runId: current.runId },
    plans,
    ...(latest
      ? {
          latest: {
            start: ym(applyLevers(setup, { start: grid[last]! / 12 })),
            pSuccess: latest.pSuccess,
            runId: latest.runId,
          },
        }
      : {}),
    simulations: cache.size,
  };
}

function range(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m += step) out.push(m);
  return out;
}
