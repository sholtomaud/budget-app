/**
 * Return-path samplers (FR-FC-020). Every model yields monthly real total
 * returns r (so a holding grows by 1 + r). Parametric models work on log
 * returns, so r > −1 always. Holdings that share a return model share its
 * path, and block-bootstrap models draw the same history months, which keeps
 * their correlation (SPEC §10.3).
 */
import { deriveSeed, Rng } from '../lib/prng.ts';
import type { ReturnModel } from './model.ts';

/** Monthly log-return parameters matching an annual arithmetic mean μ and volatility σ. */
export function monthlyLogParams(mu: number, sigma: number): { m: number; s: number } {
  const s2 = Math.log(1 + (sigma * sigma) / ((1 + mu) * (1 + mu)));
  return { m: (Math.log(1 + mu) - s2 / 2) / 12, s: Math.sqrt(s2 / 12) };
}

/** Monthly return of a fixed annual rate, compounding to exactly `rate` a year. */
export function monthlyFixed(rate: number): number {
  return Math.pow(1 + rate, 1 / 12) - 1;
}

/** Standard Student-t with ν degrees of freedom, scaled to unit variance (ν > 2). */
export function unitStudentT(rng: Rng, nu: number): number {
  const z = rng.normal();
  const chi2 = 2 * gammaSample(rng, nu / 2);
  return (z / Math.sqrt(chi2 / nu)) * Math.sqrt((nu - 2) / nu);
}

/** Gamma(shape, 1) by Marsaglia–Tsang. */
export function gammaSample(rng: Rng, shape: number): number {
  if (shape < 1) return gammaSample(rng, shape + 1) * Math.pow(1 - rng.float(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng.float();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/**
 * Illustrative monthly real log-return histories for the bootstrap models.
 * Synthetic, generated from a fixed seed with GARCH(1,1) volatility
 * clustering; labelled `illustrative`. Users replace them with imported
 * history (M8). All series share one month index so bootstrap draws are joint.
 */
export const HISTORY_MONTHS = 240;
const HISTORY_SPECS: Record<string, { mu: number; sigma: number; shockDf: number }> = {
  'synthetic-equity': { mu: 0.045, sigma: 0.16, shockDf: 6 },
  'synthetic-btc': { mu: 0.08, sigma: 0.65, shockDf: 4 },
};

let historyCache: Record<string, Float64Array> | null = null;

export function syntheticHistories(): Record<string, Float64Array> {
  if (historyCache) return historyCache;
  const rng = new Rng(deriveSeed(0x5eedn, 'synthetic-returns'));
  const common = Array.from({ length: HISTORY_MONTHS }, () => unitStudentT(rng, 6));
  const out: Record<string, Float64Array> = {};
  for (const [id, spec] of Object.entries(HISTORY_SPECS)) {
    const own = rng.fork(id);
    const { m, s } = monthlyLogParams(spec.mu, spec.sigma);
    // GARCH(1,1) on unit variance: h = ω + α ε² + β h, long-run variance 1.
    const alpha = 0.1;
    const beta = 0.85;
    const omega = 1 - alpha - beta;
    let h = 1;
    const raw = new Float64Array(HISTORY_MONTHS);
    for (let i = 0; i < HISTORY_MONTHS; i++) {
      const z = 0.6 * common[i]! + 0.8 * unitStudentT(own, spec.shockDf);
      const e = Math.sqrt(h) * z;
      raw[i] = e;
      h = omega + alpha * e * e + beta * h;
    }
    // Standardise so the series has exactly the target monthly log mean and sd.
    let mean = 0;
    for (const x of raw) mean += x / HISTORY_MONTHS;
    let v = 0;
    for (const x of raw) v += (x - mean) ** 2 / (HISTORY_MONTHS - 1);
    const sd = Math.sqrt(v);
    out[id] = raw.map((x) => m + (s * (x - mean)) / sd);
  }
  historyCache = out;
  return out;
}

/**
 * Months of evidence behind an assumed (μ, σ) when its parameters are
 * uncertain (FR-BAY-004): 30 years, as if estimated from that much history.
 */
export const ASSUMPTION_EVIDENCE_MONTHS = 360;

/**
 * One draw of a monthly log-return mean and sd, given `n` months of evidence
 * with mean `m` and sd `s` (ADR 0022). Under the reference prior
 * p(μ, σ²) ∝ 1/σ², the posterior is Normal–Inverse-Gamma:
 * σ² = (n−1)s²/χ²(n−1), then μ ~ N(m, σ²/n). Long horizons then carry the
 * risk that the average itself was misjudged, not only the year-to-year noise.
 */
export function drawLogParams(rng: Rng, m: number, s: number, n: number): { m: number; s: number } {
  const chi2 = 2 * gammaSample(rng, (n - 1) / 2);
  const s2 = ((n - 1) * s * s) / chi2;
  return { m: m + Math.sqrt(s2 / n) * rng.normal(), s: Math.sqrt(s2) };
}

/**
 * One run's return paths, keyed by return-model id: months × monthly r.
 * `frozen` replaces every model by its median monthly return (exp of the
 * mean log return), for the shortfall-driver attribution.
 * `parameterUncertainty` first draws each model's mean and volatility for
 * this run (FR-BAY-004): assumed (μ, σ) count as 30 years of evidence; a
 * bootstrap history is re-centred and re-scaled to its draw, which keeps
 * its volatility clustering. Fixed-rate models stay fixed.
 */
export function sampleReturnPaths(
  models: readonly ReturnModel[],
  months: number,
  seed: bigint,
  opts: {
    frozen?: boolean;
    histories?: Record<string, Float64Array>;
    parameterUncertainty?: boolean;
  } = {}
): Record<string, Float64Array> {
  const uncertain = !!opts.parameterUncertainty && !opts.frozen;
  /** A separate stream, so turning uncertainty on leaves the other draws unchanged. */
  const paramRng = (id: string) => new Rng(deriveSeed(seed, 'returns', 'params', id));
  const histories = opts.histories ?? syntheticHistories();
  const out: Record<string, Float64Array> = {};
  // Joint bootstrap: one sequence of history months for every bootstrap model,
  // drawn within the shortest history in use so every series has each month.
  let span = HISTORY_MONTHS;
  for (const m of models)
    if (m.kind === 'block-bootstrap' && histories[m.seriesId])
      span = Math.min(span, histories[m.seriesId]!.length);
  let bootIdx: Int32Array | null = null;
  const bootIndex = (block: number) => {
    if (bootIdx) return bootIdx;
    const rng = new Rng(deriveSeed(seed, 'returns', 'bootstrap'));
    bootIdx = new Int32Array(months);
    let i = 0;
    while (i < months) {
      const start = rng.int(span);
      for (let j = 0; j < block && i < months; j++, i++) bootIdx[i] = (start + j) % span;
    }
    return bootIdx;
  };
  for (const model of models) {
    const path = new Float64Array(months);
    const rng = new Rng(deriveSeed(seed, 'returns', model.id));
    switch (model.kind) {
      case 'fixed':
        path.fill(monthlyFixed(model.rate));
        break;
      case 'lognormal': {
        let { m, s } = monthlyLogParams(model.mu, model.sigma);
        if (uncertain)
          ({ m, s } = drawLogParams(paramRng(model.id), m, s, ASSUMPTION_EVIDENCE_MONTHS));
        if (opts.frozen) path.fill(Math.exp(m) - 1);
        else for (let i = 0; i < months; i++) path[i] = Math.exp(rng.normal(m, s)) - 1;
        break;
      }
      case 'student-t': {
        let { m, s } = monthlyLogParams(model.mu, model.sigma);
        if (uncertain)
          ({ m, s } = drawLogParams(paramRng(model.id), m, s, ASSUMPTION_EVIDENCE_MONTHS));
        if (opts.frozen) path.fill(Math.exp(m) - 1);
        else
          for (let i = 0; i < months; i++)
            path[i] = Math.exp(m + s * unitStudentT(rng, model.nu)) - 1;
        break;
      }
      case 'block-bootstrap': {
        const hist = histories[model.seriesId];
        if (!hist) throw new Error(`No return history '${model.seriesId}' for model ${model.id}`);
        if (opts.frozen) {
          let g = 0;
          for (const x of hist) g += x / hist.length;
          path.fill(Math.exp(g) - 1);
        } else {
          const idx = bootIndex(model.block);
          // With parameter uncertainty: the same months, shifted and scaled to
          // this run's draw of the mean and sd.
          let shift = 0;
          let scale = 1;
          let centre = 0;
          if (uncertain) {
            const n = hist.length;
            for (const x of hist) centre += x / n;
            let v = 0;
            for (const x of hist) v += (x - centre) ** 2 / (n - 1);
            const sd = Math.sqrt(v);
            const d = drawLogParams(paramRng(model.id), centre, sd, n);
            shift = d.m;
            scale = sd > 0 ? d.s / sd : 1;
          }
          for (let i = 0; i < months; i++) {
            const x = hist[idx[i]! % hist.length]!;
            path[i] = Math.exp(uncertain ? shift + (x - centre) * scale : x) - 1;
          }
        }
        break;
      }
    }
    out[model.id] = path;
  }
  return out;
}

/** Expected annual real return of a model (for the deterministic freedom number). */
export function expectedAnnualReturn(model: ReturnModel): number {
  switch (model.kind) {
    case 'fixed':
      return model.rate;
    case 'lognormal':
    case 'student-t':
      return model.mu;
    case 'block-bootstrap': {
      const hist = syntheticHistories()[model.seriesId];
      if (!hist) return 0;
      let g = 0;
      for (const x of hist) g += Math.exp(x) / hist.length;
      return Math.pow(g, 12) - 1;
    }
  }
}
