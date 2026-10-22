/**
 * Simulation inputs for a freedom setup, shared by the Freedom and Scenarios
 * screens: the scenario, and the spending need with its forecast spread and
 * levers applied. The forecast spread is computed once per data view and tier.
 */
import { weeklyRate } from '../budget/model.ts';
import { perWeek } from '../budget/periods.ts';
import type { DataView } from '../data/service.ts';
import type { Quantiles } from '../forecast/opex.ts';
import { monthlySeries } from '../forecast/series.ts';
import { canonicalJson, sha256Hex } from '../lib/hash.ts';
import type { Evaluation } from '../optimise/optimiser.ts';
import {
  applySpendingLevers,
  asOfFor,
  scenarioFrom,
  spendingFrom,
  type FreedomSetup,
} from '../sim/inputs.ts';
import type { Scenario, SpendingInput } from '../sim/model.ts';
import { runPool, type PoolResult } from './sim-pool.ts';
import {
  historyModel,
  historySeriesId,
  realLogReturns,
  type PriceHistory,
} from '../sim/history.ts';
import { forecast, sim } from './workers.ts';

export async function loadHistories(): Promise<PriceHistory[]> {
  return ((await sim().loadKv('histories')) as PriceHistory[] | null) ?? [];
}

export const saveHistories = (h: PriceHistory[]) => sim().saveKv('histories', h);

const cache = new WeakMap<DataView, Map<string, Promise<Quantiles | null>>>();

/** Budgeted OPEX per category per month (minor units) for a tier. */
export function budgetMonthlyFor(v: DataView, tier: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of v.budget.lines) {
    if (l.categoryId.startsWith('capex.')) continue;
    out[l.categoryId] =
      (out[l.categoryId] ?? 0) +
      (weeklyRate(l, tier, (c) => perWeek(c, v.budget.periods), new Date().toISOString()) * 52) /
        12;
  }
  return out;
}

/**
 * The OPEX forecast's total quantiles for a tier (the spending spread), from
 * the Bayesian model when it converges (ADR 0022); cached per view.
 */
export function ratioFor(v: DataView, tier: string, priorPower = 1): Promise<Quantiles | null> {
  let byTier = cache.get(v);
  if (!byTier) cache.set(v, (byTier = new Map()));
  const key = priorPower === 1 ? tier : `${tier}|${priorPower}`;
  let p = byTier.get(key);
  if (!p) {
    const history = monthlySeries(v.txns);
    const budgetMonthly = budgetMonthlyFor(v, tier);
    p =
      history.length || Object.keys(budgetMonthly).length
        ? forecast()
            .opex(history, budgetMonthly, {
              horizon: 60,
              seed: '42',
              bayes: true,
              ...(priorPower === 1 ? {} : { priorPower }),
            })
            // Prior sensitivity only means something when the Bayesian model is in use.
            .then((f) => (priorPower === 1 || f.totalSource === 'bayes' ? f.total : null))
        : Promise.resolve(null);
    byTier.set(key, p);
  }
  return p;
}

export async function inputsFor(
  v: DataView,
  setup: FreedomSetup,
  tier = setup.goal.tier,
  priorPower = 1
): Promise<{ scenario: Scenario; spending: SpendingInput }> {
  const spending = applySpendingLevers(
    spendingFrom(v, tier, await ratioFor(v, tier, priorPower)),
    setup.levers
  );
  const base = scenarioFrom(
    { ...setup, goal: { ...setup.goal, tier } },
    asOfFor(v.txns),
    v.budget.settings.cpi
  );
  // Imported price histories become bootstrap return models (deflated to real terms).
  const hist = await loadHistories();
  const scenario = hist.length
    ? {
        ...base,
        returnModels: [...base.returnModels, ...hist.map(historyModel)],
        histories: Object.fromEntries(
          hist.map((h) => [historySeriesId(h), realLogReturns(h, base.cpi)])
        ),
      }
    : base;
  return { scenario, spending };
}

/** A short, stable citation for a set of runs (SPEC §11.4: results cite their run IDs). */
export function runIdOf(r: PoolResult): string {
  return `${r.record.inputsHash.slice(0, 12)}·seed ${r.record.seed}·runs 0–${r.record.runs - 1}`;
}

export async function simulateSetup(
  v: DataView,
  setup: FreedomSetup,
  runs: number,
  keepCapital = false
): Promise<PoolResult> {
  const { scenario, spending } = await inputsFor(v, setup);
  return runPool({ scenario, spending, runs, keepCapital });
}

/** The optimiser's evaluation: pSuccess on `runs` runs with the setup's own seed. */
export function evaluator(v: DataView, runs: number): (s: FreedomSetup) => Promise<Evaluation> {
  return async (s) => {
    const r = await simulateSetup(v, s, runs);
    return { pSuccess: r.pSuccess, runId: runIdOf(r) };
  };
}

/** Hash of a setup's decisions, to tell scenarios apart. */
export const setupHash = (s: FreedomSetup) => sha256Hex(canonicalJson(s));
