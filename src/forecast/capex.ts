/**
 * CAPEX forecast (FR-FC-010): Monte-Carlo over assets. Each owned asset is
 * replaced when its Weibull life (conditional on age) runs out, and again
 * after that; cost grows by `replacementCostGrowth` (real). Wish-list items
 * count by their decision. Output: quantile paths of spend per month.
 */
import type { Asset } from '../domain/types.ts';
import { addMonths, daysBetween } from '../lib/dates.ts';
import { deriveSeed, Rng, weibullScale } from '../lib/prng.ts';
import { pathQuantiles } from './ref/bootstrap.ts';
import { QUANTILE_KEYS } from './ref/stats.ts';
import type { Quantiles } from './opex.ts';

export interface CapexForecast {
  months: string[];
  monthly: Quantiles;
  cumulative: Quantiles;
  /** Mean spend per month (real, minor units). */
  mean: number[];
  runs: number;
}

export function forecastCapex(
  assets: readonly Asset[],
  opts: { start: string; horizon: number; seed: bigint; runs?: number }
): CapexForecast {
  const h = opts.horizon;
  const runs = opts.runs ?? 2000;
  const months = Array.from({ length: h }, (_, i) =>
    addMonths(`${opts.start.slice(0, 7)}-01`, i).slice(0, 7)
  );
  const paths = new Float64Array(runs * h);
  for (const a of assets) {
    if (a.status === 'retired' || a.decision?.action === 'drop' || a.decision?.action === 'defer')
      continue;
    const cost = Number((a.forecastCost ?? a.cost).minor);
    const growth = a.replacementCostGrowth ?? 0;
    const rng = new Rng(deriveSeed(opts.seed, 'capex-fc', a.id));
    if (a.status === 'owned') {
      if (!a.replace || !a.purchasedAt) continue;
      const k = a.life.shape ?? 2.5;
      const scale = weibullScale(a.life.meanYears, k);
      const age = Math.max(0, daysBetween(a.purchasedAt, opts.start) / 365.25);
      for (let r = 0; r < runs; r++) {
        let t = rng.weibullGiven(k, scale, age) - age;
        while (t * 12 < h) {
          paths[r * h + Math.floor(t * 12)]! += cost * Math.pow(1 + growth, t);
          t += rng.weibull(k, scale);
        }
      }
    } else if (a.decision?.action === 'buy') {
      const month = a.decision.by
        ? Math.floor(daysBetween(opts.start, a.decision.by) / (365.25 / 12))
        : 0;
      if (month < 0 || month >= h) continue;
      for (let r = 0; r < runs; r++) paths[r * h + month]! += cost;
    }
  }
  const cum = new Float64Array(paths.length);
  for (let r = 0; r < runs; r++) {
    let s = 0;
    for (let i = 0; i < h; i++) {
      s += paths[r * h + i]!;
      cum[r * h + i] = s;
    }
  }
  const mean = new Array<number>(h).fill(0);
  for (let r = 0; r < runs; r++) for (let i = 0; i < h; i++) mean[i]! += paths[r * h + i]! / runs;
  const q = (p: Float64Array) =>
    Object.fromEntries(
      QUANTILE_KEYS.map((k, i) => [k, Array.from(pathQuantiles(p, h)[i]!)])
    ) as Quantiles;
  return { months, monthly: q(paths), cumulative: q(cum), mean, runs };
}
