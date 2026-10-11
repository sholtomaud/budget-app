/**
 * Forecast evaluation against synthetic truth (SPEC §16.2):
 * - OPEX: the backtest-chosen method vs seasonal naive, out of sample;
 * - replacement dates: how often the P10–P90 window covers the true date.
 */
import type { Txn } from '../domain/types.ts';
import { daysBetween } from '../lib/dates.ts';
import type { Truth, TruthLabel } from '../synth/generator.ts';
import { remainingQuantile } from '../budget/lifetime.ts';
import { weibullScale } from '../lib/prng.ts';
import { choose } from './ref/backtest.ts';
import { METHODS, seasonalNaive } from './ref/methods.ts';
import { mase } from './ref/stats.ts';
import { monthlySeries } from './series.ts';

/** Give transactions their true classification, so forecasting is scored on its own. */
export function withTruth(txns: Txn[], truth: Record<string, TruthLabel>): Txn[] {
  return txns.map((t) => {
    const l = truth[`${t.accountId}/${t.id}`];
    return l
      ? {
          ...t,
          classification: {
            kind: l.kind,
            categoryId: l.categoryId,
            confidence: 1,
            by: 'user' as const,
          },
        }
      : t;
  });
}

/** Backtest from 6 months: the most origins, so the choice rests on the most evidence. */
const MIN_TRAIN = 6;

export interface OpexEval {
  categories: number;
  /** Categories where the chosen method's holdout MASE ≤ seasonal naive's. */
  atLeastAsGood: number;
  share: number;
  rows: { categoryId: string; method: string; chosen: number; naive: number }[];
}

export function evaluateOpex(
  txns: Txn[],
  opts: { holdout: number; m?: number; seed: bigint }
): OpexEval {
  const m = opts.m ?? 12;
  const rows: OpexEval['rows'] = [];
  for (const s of monthlySeries(txns)) {
    const y = Float64Array.from(s.values);
    if (y.length < opts.holdout + 12) continue;
    if (y.filter((v) => v !== 0).length < 6) continue;
    const train = y.subarray(0, y.length - opts.holdout);
    const test = y.subarray(y.length - opts.holdout);
    const { chosen } = choose(train, { m, h: 3, minTrain: MIN_TRAIN, seed: opts.seed });
    const fit = METHODS[chosen]!(train, opts.holdout, m);
    const naive = seasonalNaive(train, opts.holdout, m);
    rows.push({
      categoryId: s.categoryId,
      method: fit.method,
      chosen: mase(test, fit.forecast, train, m),
      naive: mase(test, naive.forecast, train, m),
    });
  }
  const ok = rows.filter((r) => r.chosen <= r.naive + 1e-9).length;
  return {
    categories: rows.length,
    atLeastAsGood: ok,
    share: rows.length ? ok / rows.length : 1,
    rows,
  };
}

export interface ReplacementEval {
  assets: number;
  covered: number;
  coverage: number;
}

/** For each asset with a known life and last purchase, does P10–P90 at the start cover the true next replacement? */
export function evaluateReplacement(truths: { truth: Truth; start: string }[]): ReplacementEval {
  let n = 0;
  let covered = 0;
  for (const { truth, start } of truths) {
    for (const a of truth.assets) {
      if (!a.lifeYears || !a.shape || !a.lastBought) continue;
      const actual = a.purchases[0] ?? a.nextReplacement;
      if (!actual) continue;
      const scale = weibullScale(a.lifeYears, a.shape);
      const age = Math.max(0, daysBetween(a.lastBought, start) / 365.25);
      const lo = remainingQuantile(0.1, a.shape, scale, age);
      const hi = remainingQuantile(0.9, a.shape, scale, age);
      const t = daysBetween(start, actual) / 365.25;
      n++;
      if (t >= lo && t <= hi) covered++;
    }
  }
  return { assets: n, covered, coverage: n ? covered / n : 1 };
}
