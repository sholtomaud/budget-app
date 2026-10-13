/**
 * The Bayesian spending model inside the forecast (ADR 0022): the total
 * spending paths the simulation uses, and the checks shown in the model
 * panel (FR-BAY-006…008).
 *
 * Categories with enough months of spending are fitted jointly; the rest
 * keep their own forecast paths (often the budget line) and are added in.
 * When the sampler's diagnostics fail even after a longer run, the total
 * falls back to the per-category forecasts, and the report says why.
 */
import { Rng, deriveSeed } from '../lib/prng.ts';
import { pit } from './diagnostics.ts';
import {
  drawFromPrior,
  fitSpending,
  predictSpending,
  spendingData,
  type Diagnostics,
  type FitOptions,
  type SpendingData,
  type SpendingPosterior,
} from './spending.ts';

export interface BayesReport {
  /** The total comes from the Bayesian model. */
  used: boolean;
  /** Why it is not used, in plain words; empty when used. */
  reason: string;
  /** The categories fitted jointly. */
  categories: string[];
  diagnostics: Diagnostics | null;
  /** The first run failed its diagnostics and a longer one was made. */
  retried: boolean;
  /** How strongly categories move together: the factor's loading (P10, P50, P90) and persistence. */
  factor: { lambda: [number, number, number]; phi: number } | null;
  checks?: BayesChecks;
}

export interface BayesChecks {
  /**
   * Fitted without the last months, scored on them: the share of held-out
   * category-months inside P10–P90 (by randomised PIT), and the PITs.
   */
  holdout: { months: number; points: number; coverage: number; pits: number[] } | null;
  /** Next 12 months' total spending (P50, P90) with the priors weakened and strengthened. */
  priorSensitivity: { power: number; p50: number; p90: number }[];
  /** Month-to-month change in total spending (sd of log change): the data's, and the prior's P5–P95. */
  priorPredictive: { observed: number; p5: number; p50: number; p95: number } | null;
}

/** Settings for the main fit, the retry, and the lighter fits behind the checks. */
export const MAIN_FIT = { chains: 4, warmup: 1000, draws: 500 };
const RETRY_FIT = { chains: 4, warmup: 2000, draws: 1000 };
const CHECK_FIT = { chains: 2, warmup: 500, draws: 250 };
const HOLDOUT_MONTHS = 6;
/** Prior power-scaling: weaker and stronger than the model's priors. */
export const PRIOR_POWERS = [0.5, 2];

const quantile = (xs: Float64Array | number[], q: number) => {
  const s = Float64Array.from(xs).sort();
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  return s[lo]! + (pos - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? 0) - s[lo]!);
};

/** Sum of the first `k` months of each path. */
function pathSums(paths: Float64Array, h: number, k: number): Float64Array {
  const n = paths.length / h;
  const out = new Float64Array(n);
  for (let p = 0; p < n; p++) for (let i = 0; i < k; i++) out[p]! += paths[p * h + i]!;
  return out;
}

export function bayesTotal(
  history: readonly { categoryId: string; months: string[]; values: number[] }[],
  others: Map<string, Float64Array>,
  opts: {
    horizon: number;
    nPaths: number;
    seed: bigint;
    checks?: boolean;
    /** Power-scale the priors (prior sensitivity of the plan's chance, ADR 0032); 1 = as built. */
    priorPower?: number;
  }
): { report: BayesReport; total: Float64Array | null } {
  const data = spendingData(history);
  const none = (reason: string): { report: BayesReport; total: null } => ({
    report: {
      used: false,
      reason,
      categories: [],
      diagnostics: null,
      retried: false,
      factor: null,
    },
    total: null,
  });
  if (!data)
    return none('Not enough history: the model needs categories with 3 months of spending.');
  if (data.values[0]!.length < 12)
    return none('Not enough history: the model needs at least 12 months.');
  const seed = deriveSeed(opts.seed, 'bayes');
  const { post, retried } = fitted(data, seed, opts.priorPower ?? 1);
  const d = post.diagnostics;
  const report: BayesReport = {
    used: d.ok,
    reason: d.ok
      ? ''
      : `The sampler did not converge (R̂ ${d.rhatMax.toFixed(2)} for ${d.worst}), so the per-category forecasts are used.`,
    categories: data.categories,
    diagnostics: d,
    retried,
    factor: {
      lambda: [quantile(post.lambda, 0.1), quantile(post.lambda, 0.5), quantile(post.lambda, 0.9)],
      phi: quantile(post.phi, 0.5),
    },
  };
  let total: Float64Array | null = null;
  if (d.ok) {
    const h = opts.horizon;
    total = predictSpending(post, h, deriveSeed(seed, 'paths'), opts.nPaths).total;
    const fitted = new Set(data.categories);
    for (const [id, paths] of others) {
      if (fitted.has(id)) continue;
      for (let i = 0; i < total.length; i++) total[i]! += paths[i]!;
    }
  }
  if (opts.checks) report.checks = bayesChecks(history, opts.seed) ?? undefined;
  return { report, total };
}

/**
 * The main fit, retried once if its diagnostics fail. Cached by data and
 * seed: the Forecast and Freedom screens ask for the same fit, and the
 * result is deterministic, so the second asks for nothing new.
 */
const fitCache = new Map<string, { post: SpendingPosterior; retried: boolean }>();
function fitted(
  data: SpendingData,
  seed: bigint,
  priorPower = 1
): { post: SpendingPosterior; retried: boolean } {
  const key = `${seed}|${priorPower}|${data.firstMonth}|${data.categories.join(',')}|${data.values.map((v) => v.join(',')).join(';')}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  // A prior-sensitivity refit is a comparison, like the model checks: the lighter settings do.
  const power = priorPower === 1 ? {} : { priorPower };
  let post = fitSpending(data, { seed, ...(priorPower === 1 ? MAIN_FIT : CHECK_FIT), ...power });
  let retried = false;
  if (!post.diagnostics.ok) {
    retried = true;
    post = fitSpending(data, { seed: deriveSeed(seed, 'retry'), ...RETRY_FIT, ...power });
  }
  if (fitCache.size >= 4) fitCache.delete(fitCache.keys().next().value!);
  const out = { post, retried };
  fitCache.set(key, out);
  return out;
}

/**
 * The model checks (holdout calibration, prior sensitivity, prior
 * predictive), run separately so a screen can show the forecast first.
 */
export function bayesChecks(
  history: readonly { categoryId: string; months: string[]; values: number[] }[],
  seed: bigint
): BayesChecks | null {
  const data = spendingData(history);
  if (!data || data.values[0]!.length < 12) return null;
  return checks(data, history, deriveSeed(seed, 'bayes'));
}

function checks(
  data: SpendingData,
  history: readonly { categoryId: string; values: number[] }[],
  seed: bigint
): BayesChecks {
  const T = data.values[0]!.length;
  // Holdout calibration: fit without the last months, then the randomised
  // PIT of each held-out category-month. A month counts as inside the P10–P90
  // range when its PIT is in [0.1, 0.9]; ties (zero-spend months under a
  // forecast that is often zero) are spread uniformly, so a $0 month is not
  // "inside" just because P10 is $0.
  let holdout: BayesChecks['holdout'] = null;
  const train = T - HOLDOUT_MONTHS;
  if (train >= 12) {
    const sub: SpendingData = { ...data, values: data.values.map((v) => v.slice(0, train)) };
    const post = fitSpending(sub, { seed: deriveSeed(seed, 'holdout'), ...CHECK_FIT });
    const pred = predictSpending(post, HOLDOUT_MONTHS, deriveSeed(seed, 'holdout-paths'), 1000);
    const ties = new Rng(deriveSeed(seed, 'holdout-ties'));
    const pits: number[] = [];
    data.categories.forEach((_, c) => {
      const paths = pred.categories[c]!;
      for (let k = 0; k < HOLDOUT_MONTHS; k++) {
        const col = Array.from({ length: 1000 }, (_, p) => paths[p * HOLDOUT_MONTHS + k]!);
        pits.push(pit(col, data.values[c]![train + k]!, ties.float()));
      }
    });
    holdout = {
      months: HOLDOUT_MONTHS,
      points: pits.length,
      coverage: pits.filter((u) => u >= 0.1 && u <= 0.9).length / pits.length,
      pits,
    };
  }
  // Prior sensitivity: the next 12 months' total with the priors power-scaled.
  const priorSensitivity = [1, ...PRIOR_POWERS].map((power) => {
    const fit: FitOptions = {
      seed: deriveSeed(seed, 'power', power),
      ...CHECK_FIT,
      priorPower: power,
    };
    const post = fitSpending(data, fit);
    const sums = pathSums(
      predictSpending(post, 12, deriveSeed(seed, 'power-paths'), 1000).total,
      12,
      12
    );
    return { power, p50: quantile(sums, 0.5), p90: quantile(sums, 0.9) };
  });
  // Prior predictive: how volatile is total spending under the priors alone,
  // with each category held at its observed size (the check is of the priors
  // on how spending moves, not on how big each category is)?
  const volatility = (values: number[][]) => {
    const tot = values[0]!.map((_, t) => values.reduce((a, v) => a + v[t]!, 0));
    const ch: number[] = [];
    for (let t = 1; t < tot.length; t++)
      if (tot[t]! > 0 && tot[t - 1]! > 0) ch.push(Math.log(tot[t]! / tot[t - 1]!));
    const m = ch.reduce((a, b) => a + b, 0) / Math.max(1, ch.length);
    return Math.sqrt(ch.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ch.length - 1));
  };
  const levelMean = data.values.map((v) => {
    const pos = v.filter((y) => y > 0);
    return pos.reduce((a, y) => a + Math.log(y), 0) / pos.length;
  });
  const pi = data.values.map((v) => {
    const zeros = v.filter((y) => y === 0).length;
    return zeros ? (v.length - zeros) / v.length : 1;
  });
  const rng = new Rng(deriveSeed(seed, 'prior-predictive'));
  const sims = Array.from({ length: 400 }, () =>
    volatility(
      drawFromPrior({ months: T, firstMonth: data.firstMonth, levelMean, pi, levelSd: 0 }, rng)
        .values
    )
  );
  const fitted = new Set(data.categories);
  const observed = volatility(history.filter((s) => fitted.has(s.categoryId)).map((s) => s.values));
  return {
    holdout,
    priorSensitivity,
    priorPredictive: {
      observed,
      p5: quantile(sims, 0.05),
      p50: quantile(sims, 0.5),
      p95: quantile(sims, 0.95),
    },
  };
}
