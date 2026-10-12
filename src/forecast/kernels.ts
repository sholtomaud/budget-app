/**
 * The numeric kernels behind forecasting, switchable between the TypeScript
 * reference implementations and ml-core (WASM). Parity tests hold the two
 * within 1e-9 relative (SPEC §15.2).
 */
import { Rng } from '../lib/prng.ts';
import { ffbs, kfLoglik } from './ref/ffbs.ts';
import { QUANTILES, quantileSorted } from './ref/stats.ts';

export interface RunResult {
  forecast: Float64Array;
  residuals: Float64Array;
  sse: number;
}

export interface Kernels {
  name: 'ts' | 'ml-core';
  etsRun(
    y: Float64Array,
    h: number,
    m: number,
    alpha: number,
    beta: number,
    gamma: number,
    phi: number,
    seasonal: boolean
  ): RunResult;
  crostonRun(
    y: Float64Array,
    h: number,
    alpha: number,
    beta: number,
    variant: 'croston' | 'sba' | 'tsb'
  ): RunResult;
  /** Residual bootstrap paths, run-major, from a fresh SplitMix64 stream seeded with `seed`. */
  bootstrapPaths(
    forecast: Float64Array,
    residuals: Float64Array,
    nPaths: number,
    seed: bigint
  ): Float64Array;
  /** P5…P95 per step; one array per quantile, each h long. */
  pathQuantiles(paths: Float64Array, h: number): Float64Array[];
  /** One draw of a scalar state path by forward-filtering backward-sampling (ADR 0022). */
  ffbs(
    y: Float64Array,
    v: Float64Array,
    phi: number,
    w: number,
    m0: number,
    c0: number,
    z: Float64Array
  ): Float64Array;
  /** The same model's log-likelihood with the states integrated out (Kalman filter). */
  kfLoglik(
    y: Float64Array,
    v: Float64Array,
    phi: number,
    w: number,
    m0: number,
    c0: number
  ): number;
}

// ---- TypeScript reference ----

function etsRunTs(
  y: Float64Array,
  h: number,
  m: number,
  alpha: number,
  beta: number,
  gamma: number,
  phi: number,
  seasonal: boolean
): RunResult {
  const n = y.length;
  let level: number;
  let trend: number;
  const season = new Float64Array(seasonal ? m : 1);
  if (seasonal) {
    // Classical decomposition of the first two seasons: a line through the
    // two seasonal means, and seasonal indices from the detrended values.
    let a = 0;
    let b = 0;
    for (let i = 0; i < m; i++) {
      a += y[i]!;
      b += y[i + m]!;
    }
    a /= m;
    b /= m;
    trend = (b - a) / m;
    const centre = (m - 1) / 2;
    const line = (t: number) => a + trend * (t - centre);
    for (let i = 0; i < m; i++) season[i] = (y[i]! - line(i) + (y[i + m]! - line(i + m))) / 2;
    level = line(-1);
  } else {
    level = y[0]!;
    trend = n > 1 ? y[1]! - y[0]! : 0;
  }
  const residuals = new Float64Array(n);
  let sse = 0;
  for (let t = 0; t < n; t++) {
    const s = seasonal ? season[t % m]! : 0;
    const fitted = level + phi * trend + s;
    const e = y[t]! - fitted;
    residuals[t] = e;
    sse += e * e;
    const prevLevel = level;
    level = prevLevel + phi * trend + alpha * e;
    trend = phi * trend + beta * e;
    if (seasonal) season[t % m] = s + gamma * e;
  }
  const forecast = new Float64Array(h);
  let damp = 0;
  for (let i = 0; i < h; i++) {
    damp += Math.pow(phi, i + 1);
    forecast[i] = level + damp * trend + (seasonal ? season[(n + i) % m]! : 0);
  }
  return { forecast, residuals, sse };
}

function crostonRunTs(
  y: Float64Array,
  h: number,
  alpha: number,
  beta: number,
  variant: 'croston' | 'sba' | 'tsb'
): RunResult {
  const n = y.length;
  let firstNz = -1;
  for (let i = 0; i < n; i++) {
    if (y[i]! !== 0) {
      firstNz = i;
      break;
    }
  }
  const residuals = new Float64Array(n);
  if (firstNz < 0) return { forecast: new Float64Array(h), residuals, sse: 0 };
  let z = y[firstNz]!;
  let p = variant === 'tsb' ? 1 / (firstNz + 1) : firstNz + 1;
  let q = 1;
  const pred = () =>
    variant === 'tsb' ? p * z : (variant === 'sba' ? 1 - alpha / 2 : 1) * (z / p);
  let sse = 0;
  for (let t = 0; t < n; t++) {
    const f = t <= firstNz ? 0 : pred();
    const e = y[t]! - f;
    residuals[t] = e;
    if (t > firstNz) sse += e * e;
    if (t <= firstNz) continue;
    if (variant === 'tsb') {
      if (y[t]! !== 0) {
        z += alpha * (y[t]! - z);
        p += beta * (1 - p);
      } else p += beta * (0 - p);
    } else if (y[t]! !== 0) {
      z += alpha * (y[t]! - z);
      p += alpha * (q - p);
      q = 1;
    } else q++;
  }
  return { forecast: new Float64Array(h).fill(pred()), residuals, sse };
}

function bootstrapPathsTs(
  forecast: Float64Array,
  residuals: Float64Array,
  nPaths: number,
  seed: bigint
): Float64Array {
  const rng = new Rng(seed);
  const h = forecast.length;
  const r = residuals.length;
  const out = new Float64Array(nPaths * h);
  for (let p = 0; p < nPaths; p++) {
    let drift = 0;
    for (let i = 0; i < h; i++) {
      const e = r ? residuals[rng.int(r)]! : 0;
      // Errors partly persist: a pure random walk overstates the spread of spending series.
      drift = 0.5 * drift + e;
      const v = forecast[i]! + drift;
      out[p * h + i] = v > 0 ? v : 0;
    }
  }
  return out;
}

function pathQuantilesTs(paths: Float64Array, h: number): Float64Array[] {
  const n = paths.length / h;
  const col = new Float64Array(n);
  const out = QUANTILES.map(() => new Float64Array(h));
  for (let i = 0; i < h; i++) {
    for (let p = 0; p < n; p++) col[p] = paths[p * h + i]!;
    col.sort();
    QUANTILES.forEach((q, k) => (out[k]![i] = quantileSorted(col, q)));
  }
  return out;
}

export const tsKernels: Kernels = {
  name: 'ts',
  etsRun: etsRunTs,
  crostonRun: crostonRunTs,
  bootstrapPaths: bootstrapPathsTs,
  pathQuantiles: pathQuantilesTs,
  ffbs,
  kfLoglik,
};

let active: Kernels = tsKernels;

export function kernels(): Kernels {
  return active;
}

export function useKernels(k: Kernels): void {
  active = k;
}
