import { kernels } from '../kernels.ts';

/**
 * Forecasting methods (SPEC §10.1). Each fits to a monthly series and returns
 * point forecasts for h steps plus in-sample one-step residuals, which the
 * bootstrap uses for quantiles. All deterministic: parameters by grid search.
 */
export interface Fit {
  method: string;
  forecast: Float64Array;
  /** One-step-ahead in-sample residuals (actual − fitted), for the residual bootstrap. */
  residuals: Float64Array;
  params: Record<string, number>;
}

export type Method = (y: Float64Array, h: number, m: number) => Fit;

/** Seasonal naive: next year repeats last year (naive when shorter than a season). */
export const seasonalNaive: Method = (y, h, m) => {
  const n = y.length;
  const lag = n >= m ? m : 1;
  const forecast = new Float64Array(h);
  for (let i = 0; i < h; i++) forecast[i] = n ? y[n - lag + (i % lag)]! : 0;
  const residuals = new Float64Array(Math.max(0, n - lag));
  for (let i = lag; i < n; i++) residuals[i - lag] = y[i]! - y[i - lag]!;
  return { method: lag === m ? 'seasonal-naive' : 'naive', forecast, residuals, params: { lag } };
};

/** The historical mean: the right baseline for flat, noisy series. */
export const meanMethod: Method = (y, h) => {
  const n = y.length;
  let mu = 0;
  for (let i = 0; i < n; i++) mu += y[i]!;
  mu = n ? mu / n : 0;
  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) residuals[i] = y[i]! - mu;
  return {
    method: 'mean',
    forecast: new Float64Array(h).fill(mu),
    residuals,
    params: { mean: mu },
  };
};

/**
 * Additive Holt–Winters with a damped trend (ETS(A,Ad,A)); with fewer than
 * three full seasons of data, the seasonal component is dropped (ETS(A,Ad,N)):
 * twelve seasonal indices from two observations each just fit noise.
 * The recursion itself is a kernel (TS reference or ml-core).
 */
export function etsRun(
  y: Float64Array,
  h: number,
  m: number,
  alpha: number,
  beta: number,
  gamma: number,
  phi: number,
  seasonal: boolean
) {
  return kernels().etsRun(y, h, m, alpha, beta, gamma, phi, seasonal);
}

const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7];
const BETAS = [0, 0.01, 0.05, 0.1];
const GAMMAS = [0, 0.05, 0.1, 0.2, 0.3];
const PHIS = [0.8, 0.9, 0.98, 1];

export const SEASONAL_MIN_SEASONS = 3;

export const ets: Method = (y, h, m) => {
  const seasonal = y.length >= SEASONAL_MIN_SEASONS * m;
  let best = { sse: Infinity, a: 0, b: 0, g: 0, p: 1 };
  for (const a of ALPHAS) {
    for (const b of BETAS) {
      if (b > a) continue;
      for (const g of seasonal ? GAMMAS : [0]) {
        if (g > 1 - a) continue;
        for (const p of PHIS) {
          const r = etsRun(y, 0, m, a, b, g, p, seasonal);
          if (r.sse < best.sse) best = { sse: r.sse, a, b, g, p };
        }
      }
    }
  }
  const r = etsRun(y, h, m, best.a, best.b, best.g, best.p, seasonal);
  return {
    method: seasonal ? 'ets-additive-damped' : 'holt-damped',
    forecast: r.forecast,
    residuals: r.residuals.slice(seasonal ? m : 1),
    params: { alpha: best.a, beta: best.b, gamma: best.g, phi: best.p },
  };
};

/**
 * Croston's method for intermittent demand, and its variants:
 * 'sba' (Syntetos–Boylan bias correction) and 'tsb' (Teunter–Syntetos–Babai,
 * which updates the demand probability every period).
 */
export function crostonRun(
  y: Float64Array,
  h: number,
  alpha: number,
  beta: number,
  variant: 'croston' | 'sba' | 'tsb'
) {
  return kernels().crostonRun(y, h, alpha, beta, variant);
}

function crostonMethod(variant: 'croston' | 'sba' | 'tsb'): Method {
  return (y, h) => {
    let best = { sse: Infinity, a: 0.1, b: 0.1 };
    for (const a of [0.05, 0.1, 0.2, 0.3]) {
      for (const b of variant === 'tsb' ? [0.05, 0.1, 0.2, 0.3] : [a]) {
        const r = crostonRun(y, 0, a, b, variant);
        if (r.sse < best.sse) best = { sse: r.sse, a, b };
      }
    }
    const r = crostonRun(y, h, best.a, best.b, variant);
    return {
      method: variant,
      forecast: r.forecast,
      residuals: r.residuals,
      params: { alpha: best.a, beta: best.b },
    };
  };
}

export const croston = crostonMethod('croston');
export const sba = crostonMethod('sba');
export const tsb = crostonMethod('tsb');

/** Share of zero months: above 30 % the series is intermittent. */
export function zeroShare(y: Float64Array): number {
  let z = 0;
  for (const v of y) if (v === 0) z++;
  return y.length ? z / y.length : 0;
}

export const METHODS: Record<string, Method> = {
  'seasonal-naive': seasonalNaive,
  mean: meanMethod,
  ets,
  croston,
  sba,
  tsb,
};
