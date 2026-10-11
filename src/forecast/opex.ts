/**
 * OPEX forecasts per category (FR-FC-001): the method is chosen per series
 * by rolling-origin backtest; quantiles come from the residual bootstrap.
 * Short histories (< 6 months) fall back to the budget line, labelled
 * `budgeted`. Everything is in real terms; callers inflate by CPI.
 */
import { addMonths } from '../lib/dates.ts';
import { deriveSeed, Rng } from '../lib/prng.ts';
import { choose, type Score } from './ref/backtest.ts';
import { bootstrapPaths, pathQuantiles } from './ref/bootstrap.ts';
import { METHODS } from './ref/methods.ts';
import { QUANTILE_KEYS, type QuantileKey } from './ref/stats.ts';
import type { MonthlySeries } from './series.ts';

export const MIN_HISTORY = 6;
export const PATHS = 1000;

export type Quantiles = Record<QuantileKey, number[]>;

export interface SeriesForecast {
  categoryId: string;
  provenance: 'forecast' | 'budgeted';
  method: string;
  scores: Score[];
  /** MASE of the chosen method, and of seasonal naive, in the backtest. */
  chosenMase: number | null;
  naiveMase: number | null;
  history: { months: string[]; values: number[] };
  months: string[];
  quantiles: Quantiles;
}

export interface OpexForecast {
  months: string[];
  series: SeriesForecast[];
  total: Quantiles;
}

function toQuantiles(q: Float64Array[]): Quantiles {
  return Object.fromEntries(QUANTILE_KEYS.map((k, i) => [k, Array.from(q[i]!)])) as Quantiles;
}

export function forecastOpex(
  history: MonthlySeries[],
  budgetMonthly: Record<string, number>,
  opts: { horizon: number; seed: bigint; m?: number }
): OpexForecast {
  const m = opts.m ?? 12;
  const h = opts.horizon;
  const histMonths = history[0]?.months ?? [];
  const nextMonth = histMonths.length
    ? addMonths(`${histMonths.at(-1)}-01`, 1)
    : addMonths(`${new Date().toISOString().slice(0, 7)}-01`, 0);
  const months = Array.from({ length: h }, (_, i) => addMonths(nextMonth, i).slice(0, 7));
  const totalPaths = new Float64Array(PATHS * h);
  const series: SeriesForecast[] = [];
  const ids = [
    ...new Set([...history.map((s) => s.categoryId), ...Object.keys(budgetMonthly)]),
  ].sort();

  for (const id of ids) {
    const s = history.find((x) => x.categoryId === id);
    const y = Float64Array.from(s?.values ?? []);
    const rng = new Rng(deriveSeed(opts.seed, 'opex', id));
    if (y.length < MIN_HISTORY || y.every((v) => v === 0)) {
      const rate = budgetMonthly[id] ?? (y.length ? y.reduce((a, b) => a + b, 0) / y.length : 0);
      if (rate === 0) continue;
      for (let i = 0; i < totalPaths.length; i++) totalPaths[i]! += rate;
      const flat = new Array<number>(h).fill(rate);
      series.push({
        categoryId: id,
        provenance: 'budgeted',
        method: budgetMonthly[id] !== undefined ? 'budget' : 'mean',
        scores: [],
        chosenMase: null,
        naiveMase: null,
        history: { months: s?.months ?? [], values: s?.values ?? [] },
        months,
        quantiles: Object.fromEntries(QUANTILE_KEYS.map((k) => [k, flat])) as Quantiles,
      });
      continue;
    }
    const minTrain = MIN_HISTORY;
    const { chosen, scores } = choose(y, {
      m,
      h: 3,
      minTrain,
      seed: deriveSeed(opts.seed, 'backtest', id),
    });
    const fit = METHODS[chosen]!(y, h, m);
    const paths = bootstrapPaths(fit, h, PATHS, rng);
    for (let i = 0; i < paths.length; i++) totalPaths[i]! += paths[i]!;
    const chosenScore = scores.find((x) => x.method === chosen);
    const naive = scores.find((x) => x.method === 'seasonal-naive');
    series.push({
      categoryId: id,
      provenance: 'forecast',
      method: fit.method,
      scores,
      chosenMase: chosenScore && Number.isFinite(chosenScore.mase) ? chosenScore.mase : null,
      naiveMase: naive && Number.isFinite(naive.mase) ? naive.mase : null,
      history: { months: s!.months, values: s!.values },
      months,
      quantiles: toQuantiles(pathQuantiles(paths, h)),
    });
  }
  return { months, series, total: toQuantiles(pathQuantiles(totalPaths, h)) };
}

/** Real → nominal: month i (0-based from the first forecast month) inflated by CPI. */
export function inflate(values: number[], cpi: number): number[] {
  return values.map((v, i) => v * Math.pow(1 + cpi, (i + 1) / 12));
}
