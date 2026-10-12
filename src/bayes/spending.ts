/**
 * The Bayesian spending model (ADR 0022, FR-BAY-001…003, 005, 006).
 *
 * For category c in month t, on months with spending,
 *
 *   log y_ct = μ_ct + s_c[month(t)] + λ f_t + ε_ct,     ε_ct ~ N(0, σ²_c)
 *   μ_ct     = μ_c,t−1 + η_ct,                          η_ct ~ N(0, τ²_c)    (local level)
 *   f_t      = φ f_t−1 + √(1 − φ²) ν_t,                 ν_t ~ N(0, 1)        (household factor)
 *
 * A month without spending is a zero from a hurdle: in a category with any
 * zero months, each month has spending with probability π_c ~ Beta(1 + n₊, 1 + n₀).
 *
 * Partial pooling: σ²_c ~ IG(a, b_σ) and τ²_c ~ IG(a, b_τ) share their scales
 * b_σ, b_τ ~ Gamma, and the seasonal effects s_c[k] ~ N(0, ω²) share ω². So a
 * short or noisy category borrows strength from the household's others.
 *
 * Inference: Gibbs sampling, with forward-filtering backward-sampling for the
 * levels and the factor (ml-core when loaded), conjugate updates for the
 * rest, and a Metropolis step for φ. Several seeded chains, checked with
 * split-R̂ and effective sample size.
 */
import { kernels } from '../forecast/kernels.ts';
import { deriveSeed, Rng } from '../lib/prng.ts';
import { gammaSample } from '../sim/returns.ts';
import { ess, splitRhat } from './diagnostics.ts';

/** Weakly informative priors on the log scale (monthly). */
export const PRIORS = {
  /**
   * σ²_c ~ IG(a, b_σ), b_σ ~ Gamma(g, h): month-to-month noise σ around 0.2
   * (±20 %). Was 0.3; the prior predictive check showed households far more
   * volatile than real ones (ADR 0022, lab notes §4.6).
   */
  sigma: { a: 3, g: 2, h: 25 },
  /** τ²_c ~ IG(a, b_τ), b_τ ~ Gamma(g, h): the level drifts about 4 % a month. */
  tau: { a: 3, g: 2, h: 625 },
  /** ω² ~ IG(a, b): seasonal effects around ±10 %. */
  season: { a: 3, b: 0.02 },
  /**
   * λ ~ half-normal(0.1): a one-sd household month moves
   * every category by about 10 % (was 20 %, too volatile in the prior
   * predictive check). One loading for all categories: with a
   * loading each, the factor can absorb one noisy category's noise (a
   * Heywood case) and the chains disagree (ADR 0022).
   */
  lambdaSd: 0.1,
  /** μ_c1 ~ N(level mean, 1). */
  levelVar: 1,
  /** φ ~ Uniform(0, 0.95). */
  phiMax: 0.95,
};

/** Floors: 1 % month-to-month noise, 0.1 % drift a month. A bill that never changes sits at them. */
export const SIGMA2_MIN = 1e-4;
export const TAU2_MIN = 1e-6;
/** Metropolis updates of each variance, λ and φ per sweep (they are cheap). */
const MH_REPEATS = 3;

/** Seasonal effects need two full years. */
export const SEASONAL_MONTHS = 24;
/** Categories need this many months with spending to be modelled. */
export const MIN_SPEND_MONTHS = 3;

export interface SpendingData {
  categories: string[];
  /** Calendar month (0 = January) of the first month. */
  firstMonth: number;
  /** values[c][t]: spending in the month, ≥ 0. */
  values: number[][];
}

export interface FitOptions {
  seed: bigint;
  chains?: number;
  warmup?: number;
  draws?: number;
  /**
   * Power-scaling of the top-level priors (λ, b_σ, b_τ, ω²): 1 is the model;
   * below 1 weakens them, above 1 strengthens them (prior sensitivity).
   */
  priorPower?: number;
  /** Prior mean of each category's starting log level; default its observed mean. */
  levelMean?: number[];
}

export interface Diagnostics {
  chains: number;
  draws: number;
  rhatMax: number;
  essMin: number;
  /** The parameter with the worst R̂. */
  worst: string;
  ok: boolean;
  params: { name: string; rhat: number; ess: number }[];
}

export interface SpendingPosterior {
  categories: string[];
  firstMonth: number;
  months: number;
  seasonal: boolean;
  /** Kept draws over all chains. */
  draws: number;
  /** Per draw × category: the last month's level, σ², τ², π. */
  level: Float64Array;
  sigma2: Float64Array;
  tau2: Float64Array;
  pi: Float64Array;
  /** Per draw × category × 12 calendar months. */
  season: Float64Array;
  /** Per draw: the factor's loading λ, its persistence φ, and its last month. */
  lambda: Float64Array;
  phi: Float64Array;
  fLast: Float64Array;
  diagnostics: Diagnostics;
}

/** R̂ and ESS thresholds for a fit to be used (FR-BAY-006). */
export const RHAT_MAX = 1.05;
export const ESS_MIN = 100;

const invGamma = (rng: Rng, shape: number, scale: number) => scale / gammaSample(rng, shape);
const gammaRate = (rng: Rng, shape: number, rate: number) => gammaSample(rng, shape) / rate;
const beta = (rng: Rng, a: number, b: number) => {
  const x = gammaSample(rng, a);
  return x / (x + gammaSample(rng, b));
};

/** n standard normals, using both outputs of each Box–Muller pair (half the uniform draws). */
function normals(rng: Rng, n: number): Float64Array {
  const z = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rng.float()));
    const t = 2 * Math.PI * rng.float();
    z[i] = r * Math.cos(t);
    if (i + 1 < n) z[i + 1] = r * Math.sin(t);
  }
  return z;
}

export function fitSpending(data: SpendingData, opts: FitOptions): SpendingPosterior {
  const chains = opts.chains ?? 4;
  const warmup = opts.warmup ?? 500;
  const keep = opts.draws ?? 250;
  const alpha = opts.priorPower ?? 1;
  const C = data.categories.length;
  const T = data.values[0]?.length ?? 0;
  if (!C || T < 2)
    throw new Error('The spending model needs at least one category and two months.');
  const seasonal = T >= SEASONAL_MONTHS;
  const mi = (t: number) => (data.firstMonth + t) % 12;
  const x = data.values.map((v) => Float64Array.from(v, (y) => (y > 0 ? Math.log(y) : NaN)));
  const nPos = x.map((xc) => xc.reduce((n, v) => (Number.isNaN(v) ? n : n + 1), 0));
  const m0 = x.map((xc, c) => {
    if (opts.levelMean) return opts.levelMean[c]!;
    let s = 0;
    let n = 0;
    for (const v of xc) if (!Number.isNaN(v)) ((s += v), n++);
    return n ? s / n : 0;
  });
  const P = PRIORS;
  const K = kernels();

  const D = chains * keep;
  const post: SpendingPosterior = {
    categories: data.categories,
    firstMonth: data.firstMonth,
    months: T,
    seasonal,
    draws: D,
    level: new Float64Array(D * C),
    lambda: new Float64Array(D),
    sigma2: new Float64Array(D * C),
    tau2: new Float64Array(D * C),
    pi: new Float64Array(D * C),
    season: new Float64Array(D * C * 12),
    phi: new Float64Array(D),
    fLast: new Float64Array(D),
    diagnostics: {
      chains,
      draws: keep,
      rhatMax: NaN,
      essMin: NaN,
      worst: '',
      ok: false,
      params: [],
    },
  };
  // Traces for the diagnostics: per chain, per parameter.
  const names = [...data.categories.flatMap((id) => [`σ ${id}`, `τ ${id}`]), 'λ', 'φ'];
  const traces = names.map(() => Array.from({ length: chains }, () => new Float64Array(keep)));

  const r = new Float64Array(T);
  const v = new Float64Array(T);
  for (let k = 0; k < chains; k++) {
    const rng = new Rng(deriveSeed(opts.seed, 'bayes', 'chain', k));
    // Over-dispersed starts, so R̂ can see chains that have not converged.
    const mu: Float64Array[] = m0.map((m) => new Float64Array(T).fill(m + 0.3 * rng.normal()));
    const s = new Float64Array(C * 12);
    let lam = 0.1 * Math.abs(rng.normal());
    const f = new Float64Array(T);
    const sig2 = Float64Array.from({ length: C }, () => 0.09 * Math.exp(rng.normal()));
    const tau2 = Float64Array.from({ length: C }, () => 0.0016 * Math.exp(rng.normal()));
    // The pooled scales b_σ, b_τ are integrated out: the variances' joint
    // prior is then Π x_c^−(a+1) · (h + Σ 1/x_c)^−(C·a + g), which removes the
    // slow funnel between a scale and its variances.
    let invS = 0;
    let invT = 0;
    for (let c = 0; c < C; c++) {
      sig2[c] = Math.max(sig2[c]!, SIGMA2_MIN);
      tau2[c] = Math.max(tau2[c]!, TAU2_MIN);
      invS += 1 / sig2[c]!;
      invT += 1 / tau2[c]!;
    }
    const gS = alpha * (P.sigma.g - 1) + 1;
    const hS = alpha * P.sigma.h;
    const gT = alpha * (P.tau.g - 1) + 1;
    const hT = alpha * P.tau.h;
    let om2 = P.season.b / (P.season.a - 1);
    let phi = 0.2 + 0.6 * rng.float();

    // Random-walk Metropolis step sizes (log scale for variances), tuned
    // towards 44 % acceptance during warmup only, then fixed.
    const stepS = new Float64Array(C).fill(0.5);
    const stepT = new Float64Array(C).fill(0.5);
    let stepPhi = 0.2;
    let stepLam = 0.05;
    let stepGS = 0.3;
    const eBar = new Float64Array(T);
    const vBar = new Float64Array(T);
    let stepGT = 0.3;
    const resid = x.map(() => new Float64Array(T));
    const llNow = new Float64Array(C);
    /** Category c's log-likelihood with its level integrated out. */
    const llCat = (c: number, s2: number, t2: number) => {
      v.fill(s2);
      return K.kfLoglik(resid[c]!, v, 1, t2, m0[c]!, P.levelVar);
    };
    const tune = (step: number, accepted: boolean, it: number) =>
      it < warmup ? step * Math.exp(((accepted ? 1 : 0) - 0.44) / Math.sqrt(1 + it)) : step;
    /** Log marginal prior of one variance x given the others' Σ 1/x, plus log x for the log-scale proposal. */
    const lpVar = (x: number, a: number, g: number, h: number, invOthers: number) =>
      -a * Math.log(x) - (C * a + g) * Math.log(h + invOthers + 1 / x);

    for (let it = 0; it < warmup + keep; it++) {
      // Per category: noise and drift variances by Metropolis on the Kalman
      // likelihood (the level integrated out, which mixes far better than
      // drawing them given the level).
      for (let c = 0; c < C; c++) {
        const xc = x[c]!;
        const rc = resid[c]!;
        for (let t = 0; t < T; t++)
          rc[t] = Number.isNaN(xc[t]!) ? NaN : xc[t]! - s[c * 12 + mi(t)]! - lam * f[t]!;
        let cur = llCat(c, sig2[c]!, tau2[c]!);
        for (let rep = 0; rep < MH_REPEATS; rep++) {
          const os = invS - 1 / sig2[c]!;
          const ps = sig2[c]! * Math.exp(stepS[c]! * rng.normal());
          const ls = ps >= SIGMA2_MIN ? llCat(c, ps, tau2[c]!) : -Infinity;
          const okS =
            Math.log(rng.float()) <
            ls - cur + lpVar(ps, P.sigma.a, gS, hS, os) - lpVar(sig2[c]!, P.sigma.a, gS, hS, os);
          if (okS) {
            sig2[c] = ps;
            invS = os + 1 / ps;
            cur = ls;
          }
          stepS[c] = tune(stepS[c]!, okS, it);
          const ot = invT - 1 / tau2[c]!;
          const pt = tau2[c]! * Math.exp(stepT[c]! * rng.normal());
          const lt = pt >= TAU2_MIN ? llCat(c, sig2[c]!, pt) : -Infinity;
          const okT =
            Math.log(rng.float()) <
            lt - cur + lpVar(pt, P.tau.a, gT, hT, ot) - lpVar(tau2[c]!, P.tau.a, gT, hT, ot);
          if (okT) {
            tau2[c] = pt;
            invT = ot + 1 / pt;
            cur = lt;
          }
          stepT[c] = tune(stepT[c]!, okT, it);
        }
        llNow[c] = cur;
      }
      // Joint moves: scale every category's σ² (then τ²) by one factor. When
      // the data say little about the variances, they wander as a group, and
      // one-at-a-time updates move that group slowly.
      for (const which of ['sigma', 'tau'] as const) {
        const xs = which === 'sigma' ? sig2 : tau2;
        const floor = which === 'sigma' ? SIGMA2_MIN : TAU2_MIN;
        const pr = which === 'sigma' ? P.sigma : P.tau;
        const g = which === 'sigma' ? gS : gT;
        const h = which === 'sigma' ? hS : hT;
        const step = which === 'sigma' ? stepGS : stepGT;
        const e = step * rng.normal();
        const k2 = Math.exp(e);
        let feasible = true;
        let invOld = 0;
        let invNew = 0;
        for (let c = 0; c < C; c++) {
          if (xs[c]! * k2 < floor) feasible = false;
          invOld += 1 / xs[c]!;
          invNew += 1 / (xs[c]! * k2);
        }
        let ok = false;
        const llNew = new Float64Array(C);
        if (feasible) {
          let d = 0;
          for (let c = 0; c < C; c++) {
            llNew[c] =
              which === 'sigma'
                ? llCat(c, sig2[c]! * k2, tau2[c]!)
                : llCat(c, sig2[c]!, tau2[c]! * k2);
            d += llNew[c]! - llNow[c]!;
          }
          // Joint marginal prior (with the log-scale Jacobian): −a Σ log x − (C a + g) log(h + Σ 1/x).
          d += -pr.a * C * e - (C * pr.a + g) * (Math.log(h + invNew) - Math.log(h + invOld));
          ok = Math.log(rng.float()) < d;
        }
        if (ok) {
          for (let c = 0; c < C; c++) xs[c] = xs[c]! * k2;
          llNow.set(llNew);
          if (which === 'sigma') invS = invNew;
          else invT = invNew;
        }
        if (which === 'sigma') stepGS = tune(stepGS, ok, it);
        else stepGT = tune(stepGT, ok, it);
      }
      // The level paths.
      for (let c = 0; c < C; c++) {
        v.fill(sig2[c]!);
        mu[c] = K.ffbs(resid[c]!, v, 1, tau2[c]!, m0[c]!, P.levelVar, normals(rng, T));
      }
      // Seasonal effects, summing to zero: an unconstrained draw from their
      // conditional, then conditioned on the constraint (exact for Gaussians).
      if (seasonal) {
        const sv = new Float64Array(12);
        for (let c = 0; c < C; c++) {
          const xc = x[c]!;
          const sum = new Float64Array(12);
          const cnt = new Float64Array(12);
          for (let t = 0; t < T; t++) {
            if (Number.isNaN(xc[t]!)) continue;
            sum[mi(t)]! += xc[t]! - mu[c]![t]! - lam * f[t]!;
            cnt[mi(t)]!++;
          }
          let total = 0;
          let vsum = 0;
          for (let j = 0; j < 12; j++) {
            const prec = cnt[j]! / sig2[c]! + 1 / om2;
            sv[j] = 1 / prec;
            s[c * 12 + j] = sum[j]! / sig2[c]! / prec + rng.normal() / Math.sqrt(prec);
            total += s[c * 12 + j]!;
            vsum += sv[j]!;
          }
          for (let j = 0; j < 12; j++) s[c * 12 + j]! -= (sv[j]! * total) / vsum;
        }
      }
      // The household factor. Per month, the categories' residuals combine
      // into one precision-weighted average ē_t = λ f_t + noise of variance
      // 1/w_t; the rest of the data says nothing about λ, φ or f. So λ and φ
      // are updated by Metropolis with the factor integrated out (a Kalman
      // likelihood), then the factor path is drawn given them.
      for (let t = 0; t < T; t++) {
        let w = 0;
        let num = 0;
        for (let c = 0; c < C; c++) {
          const xt = x[c]![t]!;
          if (Number.isNaN(xt)) continue;
          w += 1 / sig2[c]!;
          num += (xt - mu[c]![t]! - s[c * 12 + mi(t)]!) / sig2[c]!;
        }
        eBar[t] = w > 0 ? num / w : NaN;
        vBar[t] = w > 0 ? 1 / w : Infinity;
      }
      const lf = (l: number, p: number) => K.kfLoglik(eBar, vBar, p, l * l * (1 - p * p), 0, l * l);
      const lamPrec = alpha / (P.lambdaSd * P.lambdaSd);
      for (let rep = 0; rep < MH_REPEATS; rep++) {
        const pl = lam + stepLam * rng.normal();
        const okL =
          pl >= 0 &&
          Math.log(rng.float()) <
            lf(pl, phi) - lf(lam, phi) - 0.5 * lamPrec * (pl * pl - lam * lam);
        if (okL) lam = pl;
        stepLam = tune(stepLam, okL, it);
        const pp = phi + stepPhi * rng.normal();
        const okP = pp >= 0 && pp <= P.phiMax && Math.log(rng.float()) < lf(lam, pp) - lf(lam, phi);
        if (okP) phi = pp;
        stepPhi = tune(stepPhi, okP, it);
      }
      for (let t = 0; t < T; t++) {
        r[t] = lam > 0 ? eBar[t]! / lam : NaN;
        v[t] = lam > 0 ? vBar[t]! / (lam * lam) : Infinity;
      }
      f.set(K.ffbs(r, v, phi, 1 - phi * phi, 0, 1, normals(rng, T)));
      if (seasonal) {
        let ss = 0;
        for (let i = 0; i < C * 12; i++) ss += s[i]! * s[i]!;
        // Centring leaves 11 free effects per category.
        om2 = invGamma(
          rng,
          alpha * (P.season.a + 1) - 1 + (C * 11) / 2,
          alpha * P.season.b + ss / 2
        );
      }

      const j = it - warmup;
      if (j < 0) continue;
      const d = k * keep + j;
      for (let c = 0; c < C; c++) {
        const i = d * C + c;
        post.level[i] = mu[c]![T - 1]!;
        post.sigma2[i] = sig2[c]!;
        post.tau2[i] = tau2[c]!;
        const nZero = T - nPos[c]!;
        post.pi[i] = nZero > 0 ? beta(rng, 1 + nPos[c]!, 1 + nZero) : 1;
        for (let m = 0; m < 12; m++) post.season[i * 12 + m] = s[c * 12 + m]!;
        traces[c * 2]![k]![j] = Math.log(sig2[c]!) / 2;
        traces[c * 2 + 1]![k]![j] = Math.log(tau2[c]!) / 2;
      }
      post.lambda[d] = lam;
      post.phi[d] = phi;
      post.fLast[d] = f[T - 1]!;
      traces[C * 2]![k]![j] = lam;
      traces[C * 2 + 1]![k]![j] = phi;
    }
  }

  let rhatMax = 0;
  let essMin = Infinity;
  let worst = '';
  const params: Diagnostics['params'] = [];
  traces.forEach((tr, i) => {
    const rh = splitRhat(tr);
    const es = ess(tr);
    params.push({ name: names[i]!, rhat: rh, ess: es });
    if (!(rh <= rhatMax)) {
      rhatMax = rh;
      worst = names[i]!;
    }
    if (es < essMin) essMin = es;
  });
  post.diagnostics = {
    chains,
    draws: keep,
    rhatMax,
    essMin,
    worst,
    ok: rhatMax <= RHAT_MAX && essMin >= ESS_MIN,
    params,
  };
  return post;
}

/**
 * Posterior predictive paths: one path per posterior draw (or `nPaths`
 * draws spread over the chains), `h` months on
 * from the last data month. Categories in a path share the household factor,
 * so their total carries their correlation. Run-major arrays (draw × month).
 */
export function predictSpending(
  post: SpendingPosterior,
  h: number,
  seed: bigint,
  nPaths = post.draws
): { categories: Float64Array[]; total: Float64Array } {
  const C = post.categories.length;
  const cats = post.categories.map(() => new Float64Array(nPaths * h));
  const total = new Float64Array(nPaths * h);
  const mu = new Float64Array(C);
  for (let p = 0; p < nPaths; p++) {
    // Draws spread evenly over the chains.
    const d = Math.floor((p * post.draws) / nPaths);
    const rng = new Rng(deriveSeed(seed, 'bayes', 'path', p));
    const phi = post.phi[d]!;
    const innov = Math.sqrt(1 - phi * phi);
    let f = post.fLast[d]!;
    for (let c = 0; c < C; c++) mu[c] = post.level[d * C + c]!;
    for (let k = 0; k < h; k++) {
      f = phi * f + innov * rng.normal();
      const m = (post.firstMonth + post.months + k) % 12;
      for (let c = 0; c < C; c++) {
        const i = d * C + c;
        mu[c]! += Math.sqrt(post.tau2[i]!) * rng.normal();
        const s = post.seasonal ? post.season[i * 12 + m]! : 0;
        const xv = mu[c]! + s + post.lambda[d]! * f + Math.sqrt(post.sigma2[i]!) * rng.normal();
        const y = rng.float() < post.pi[i]! ? Math.exp(xv) : 0;
        cats[c]![p * h + k] = y;
        total[p * h + k]! += y;
      }
    }
  }
  return { categories: cats, total };
}

export interface PriorDraw {
  sigma2: number[];
  tau2: number[];
  lambda: number;
  phi: number;
  season: number[][];
  values: number[][];
}

/**
 * One draw from the prior and data simulated from it (prior predictive checks
 * and simulation-based calibration). `levelMean` anchors each category's
 * starting log level; `pi` is each category's chance of a month with spending.
 */
export function drawFromPrior(
  spec: {
    months: number;
    firstMonth: number;
    levelMean: number[];
    pi?: number[];
    /**
     * Spread of each category's starting log level around `levelMean`: the
     * model's prior (default), or 0 to hold category sizes at their observed
     * levels and check only the priors on how spending moves.
     */
    levelSd?: number;
  },
  rng: Rng
): PriorDraw {
  const P = PRIORS;
  const C = spec.levelMean.length;
  const T = spec.months;
  const seasonal = T >= SEASONAL_MONTHS;
  const bS = gammaRate(rng, P.sigma.g, P.sigma.h);
  const bT = gammaRate(rng, P.tau.g, P.tau.h);
  const om2 = invGamma(rng, P.season.a, P.season.b);
  const phi = P.phiMax * rng.float();
  // The floors truncate the priors, as in the fit.
  const above = (floor: number, draw: () => number) => {
    for (;;) {
      const x = draw();
      if (x >= floor) return x;
    }
  };
  const sigma2 = Array.from({ length: C }, () =>
    above(SIGMA2_MIN, () => invGamma(rng, P.sigma.a, bS))
  );
  const tau2 = Array.from({ length: C }, () => above(TAU2_MIN, () => invGamma(rng, P.tau.a, bT)));
  const lambda = Math.abs(P.lambdaSd * rng.normal());
  const season = Array.from({ length: C }, () => {
    if (!seasonal) return new Array<number>(12).fill(0);
    const raw = Array.from({ length: 12 }, () => Math.sqrt(om2) * rng.normal());
    const bar = raw.reduce((a, b) => a + b, 0) / 12;
    return raw.map((x) => x - bar);
  });
  const f = new Array<number>(T);
  f[0] = rng.normal();
  for (let t = 1; t < T; t++) f[t] = phi * f[t - 1]! + Math.sqrt(1 - phi * phi) * rng.normal();
  const values = spec.levelMean.map((m, c) => {
    let mu = m + (spec.levelSd ?? Math.sqrt(P.levelVar)) * rng.normal();
    return Array.from({ length: T }, (_, t) => {
      if (t > 0) mu += Math.sqrt(tau2[c]!) * rng.normal();
      const x =
        mu +
        season[c]![(spec.firstMonth + t) % 12]! +
        lambda * f[t]! +
        Math.sqrt(sigma2[c]!) * rng.normal();
      return rng.float() < (spec.pi?.[c] ?? 1) ? Math.exp(x) : 0;
    });
  });
  return { sigma2, tau2, lambda, phi, season, values };
}

/** The categories the model fits: enough months of spending, and not a fixed bill. */
/**
 * A bill that never changed: spending every month, all within 1 % of each
 * other. Nothing to learn, so the model leaves it out; its own forecast
 * (flat) still counts in the total.
 */
export function isFixedBill(values: readonly number[]): boolean {
  if (!values.length || values.some((v) => v <= 0)) return false;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (hi - lo) / hi < 0.01;
}

export function spendingData(
  series: readonly { categoryId: string; months: string[]; values: number[] }[]
): SpendingData | null {
  const fit = series.filter(
    (s) => s.values.filter((v) => v > 0).length >= MIN_SPEND_MONTHS && !isFixedBill(s.values)
  );
  const first = fit[0]?.months[0];
  if (!first || fit[0]!.months.length < 2) return null;
  return {
    categories: fit.map((s) => s.categoryId),
    firstMonth: Number(first.slice(5, 7)) - 1,
    values: fit.map((s) => s.values),
  };
}
