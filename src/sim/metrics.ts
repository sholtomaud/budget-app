/**
 * Goal metrics (FR-GOAL, SPEC §11.3). Each metric is a function of the
 * scenario and a `Runner`, so the same code runs in tests (one thread) and
 * in the app (the worker pool). Comparisons between variants use common
 * random numbers: run i has the same seed in every variant.
 */
import type { Provenance } from '../domain/types.ts';
import { addMonths } from '../lib/dates.ts';
import type { Freeze } from './controller.ts';
import type { Holding, Scenario, SpendingInput } from './model.ts';
import { monthsBetween } from './modelgen.ts';
import type { SimResult } from './montecarlo.ts';
import { taxTable, totalTax } from './tax.ts';

export interface RunRequest {
  scenario: Scenario;
  spending: SpendingInput;
  runs: number;
  freeze?: Freeze;
  holdingScale?: number;
  crossing?: number;
  keepCapital?: boolean;
}

export type Runner = (req: RunRequest) => Promise<SimResult>;

const dollars = (minor: bigint) => Number(minor) / 100;

/** The default withdrawal rate when the strategy does not set one (assumed). */
export const DEFAULT_WITHDRAWAL_RATE = 0.04;

export function withdrawalRate(s: Scenario): number {
  const w = s.decisions.withdrawal;
  if (w.kind === 'percent') return w.rate;
  if (w.kind === 'guardrails' && w.initialRate !== undefined) return w.initialRate;
  return DEFAULT_WITHDRAWAL_RATE;
}

export interface DeterministicFreedom {
  /** Annual spending need of the tier: OPEX plus annualised CAPEX, less project income. */
  annualNeed: number;
  /** Gross withdrawal that leaves annualNeed after tax. */
  grossWithdrawal: number;
  withdrawalRate: number;
  freedomNumber: number;
  provenance: Provenance;
}

/**
 * The spreadsheet definition (SPEC §11.3): capital for the tier's annual need,
 * grossed up for tax, at the withdrawal rate. Tax treats the whole withdrawal
 * as taxable income split evenly between the people, which overstates tax
 * for super and capital withdrawals: a conservative, `assumed` figure.
 */
export function deterministicFreedom(s: Scenario, spending: SpendingInput): DeterministicFreedom {
  const opex = Object.values(spending.tier).reduce((a, b) => a + b, 0);
  const annualNeed = Math.max(
    0,
    12 * (opex + spending.capexMonthly) - dollars(s.goal.projectIncome ?? 0n)
  );
  let gross = annualNeed;
  if (s.taxTable) {
    const t = taxTable(s.taxTable);
    const people = Math.max(1, s.people.length);
    const net = (g: number) => g - people * totalTax(t, g / people);
    let lo = annualNeed;
    let hi = annualNeed * 2 + 1;
    while (net(hi) < annualNeed) hi *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (net(mid) < annualNeed) lo = mid;
      else hi = mid;
    }
    gross = hi;
  }
  const wr = withdrawalRate(s);
  return {
    annualNeed,
    grossWithdrawal: gross,
    withdrawalRate: wr,
    freedomNumber: gross / wr,
    provenance: 'assumed',
  };
}

export function totalCapital(s: Scenario, scale = 1): number {
  return (
    dollars(s.decisions.bankBuffer) + s.holdings.reduce((a, h) => a + dollars(h.value) * scale, 0)
  );
}

/** The scenario as if freedom started now (asOf moves to the goal's start month). */
export function freedomNow(s: Scenario): Scenario {
  const asOf = s.goal.start.slice(0, 7);
  return {
    ...s,
    asOf,
    decisions: { ...s.decisions, workUntil: undefined },
    // Preservation still applies from its own date; acquisition ages carry over.
    holdings: s.holdings.map((h): Holding => ({ ...h })),
  };
}

export interface P90Freedom {
  /** Smallest starting capital with pSuccess ≥ target, or null if not found below the search cap. */
  capital: number | null;
  target: number;
  runs: number;
  iterations: number;
  /** pSuccess at the reported capital. */
  pSuccess: number | null;
}

/**
 * Freedom number at the target probability (SPEC §11.3): bisection over a
 * uniform scale of today's holdings, with freedom starting at the goal's
 * start, using common random numbers across all candidates.
 */
export async function p90Freedom(
  s: Scenario,
  spending: SpendingInput,
  run: Runner,
  opts: { runs?: number; target?: number; iterations?: number } = {}
): Promise<P90Freedom> {
  const runs = opts.runs ?? 200;
  const target = opts.target ?? 0.9;
  const iterations = opts.iterations ?? 10;
  const base = freedomNow(s);
  const cap1 = totalCapital(base, 1);
  const bank = dollars(s.decisions.bankBuffer);
  const invested = cap1 - bank;
  if (invested <= 0) return { capital: null, target, runs, iterations: 0, pSuccess: null };
  const p = async (scale: number) =>
    (await run({ scenario: base, spending, runs, holdingScale: scale, keepCapital: false }))
      .pSuccess;

  let lo = 0;
  let hi = Math.max(1, deterministicFreedom(s, spending).freedomNumber / invested);
  let pHi = await p(hi);
  let n = 1;
  while (pHi < target) {
    lo = hi;
    hi *= 2;
    if (hi * invested > 1e9) return { capital: null, target, runs, iterations: n, pSuccess: pHi };
    pHi = await p(hi);
    n++;
  }
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const pm = await p(mid);
    n++;
    if (pm >= target) {
      hi = mid;
      pHi = pm;
    } else lo = mid;
  }
  return { capital: bank + hi * invested, target, runs, iterations: n, pSuccess: pHi };
}

export interface YearsToFreedom {
  /** Years until real capital first reaches `capital`; null where most runs never do. */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Share of runs that reach it within the horizon. */
  reached: number;
  capital: number;
}

/** Years to freedom (SPEC §11.3): keep working and saving; when does capital first reach `capital`? */
export async function yearsToFreedom(
  s: Scenario,
  spending: SpendingInput,
  capital: number,
  run: Runner,
  opts: { runs?: number } = {}
): Promise<YearsToFreedom> {
  const runs = opts.runs ?? 200;
  const end = addMonths(`${s.goal.start.slice(0, 7)}-01`, Math.round(s.goal.horizonYears * 12));
  const working: Scenario = {
    ...s,
    goal: { ...s.goal, start: end, horizonYears: 0 },
    decisions: { ...s.decisions, workUntil: end },
  };
  const res = await run({
    scenario: working,
    spending,
    runs,
    crossing: capital,
    keepCapital: false,
  });
  const months = res.summaries
    .map((r) => (r.crossMonth < 0 ? Infinity : r.crossMonth))
    .sort((a, b) => a - b);
  const q = (p: number) => {
    const v = months[Math.min(months.length - 1, Math.floor(p * months.length))]!;
    return Number.isFinite(v) ? v / 12 : null;
  };
  return {
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    reached: months.filter(Number.isFinite).length / Math.max(1, months.length),
    capital,
  };
}

/**
 * Project runway (SPEC §11.3): months of fully funded chosen work available
 * now at the goal tier, from capital you can spend today (bank and holdings
 * already accessible, excluding property), net of project income.
 */
export function projectRunway(s: Scenario, spending: SpendingInput): number {
  const now = s.asOf;
  const liquid =
    dollars(s.decisions.bankBuffer) +
    s.holdings
      .filter((h) => h.assetClass !== 'property')
      .filter((h) => !h.accessibleFrom || monthsBetween(now, h.accessibleFrom) <= 0)
      .reduce((a, h) => a + dollars(h.value), 0);
  const monthly =
    Object.values(spending.tier).reduce((a, b) => a + b, 0) +
    spending.capexMonthly -
    dollars(s.goal.projectIncome ?? 0n) / 12;
  return monthly <= 0 ? Infinity : liquid / monthly;
}

export interface Driver {
  input: 'returns' | 'spending' | 'capex';
  label: string;
  /** pSuccess with this input frozen at its median, minus the baseline. */
  delta: number;
  pSuccess: number;
}

/**
 * Shortfall drivers (SPEC §11.3): re-run with each stochastic input frozen at
 * its median and report the change in pSuccess. Largest effect first. A
 * positive delta means that input's uncertainty is costing you success.
 */
export async function shortfallDrivers(
  s: Scenario,
  spending: SpendingInput,
  main: SimResult,
  run: Runner,
  opts: { runs?: number } = {}
): Promise<Driver[]> {
  const runs = Math.min(opts.runs ?? 200, main.runs);
  // The baseline over the same runs, so each comparison uses common random numbers.
  const same = main.summaries.filter((r) => r.run < runs && r.valid);
  const baseline = same.filter((r) => r.success).length / Math.max(1, same.length);
  const inputs: [Driver['input'], string][] = [
    ['returns', 'Investment returns'],
    ['spending', 'Spending uncertainty'],
    ['capex', 'Timing of capital purchases'],
  ];
  const out: Driver[] = [];
  for (const [input, label] of inputs) {
    const res = await run({
      scenario: s,
      spending,
      runs,
      freeze: { [input]: true },
      keepCapital: false,
    });
    out.push({ input, label, delta: res.pSuccess - baseline, pSuccess: res.pSuccess });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
