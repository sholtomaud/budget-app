/** Quantiles, MASE and pinball loss (SPEC §10, §16.2). */

export const QUANTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95] as const;
export type QuantileKey = 'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95';
export const QUANTILE_KEYS: QuantileKey[] = ['p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'];

/** Quantile of an ascending-sorted array, linear interpolation between order statistics (type 7). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Mean absolute scaled error: MAE of the forecast over the in-sample MAE of the (seasonal) naive forecast. */
export function mase(
  actual: ArrayLike<number>,
  forecast: ArrayLike<number>,
  train: ArrayLike<number>,
  m: number
): number {
  let num = 0;
  for (let i = 0; i < actual.length; i++) num += Math.abs(actual[i]! - forecast[i]!);
  num /= actual.length;
  const lag = train.length > m ? m : 1;
  let den = 0;
  let k = 0;
  for (let i = lag; i < train.length; i++) {
    den += Math.abs(train[i]! - train[i - lag]!);
    k++;
  }
  den = k ? den / k : 0;
  if (den === 0) return num === 0 ? 0 : Infinity;
  return num / den;
}

/** Pinball (quantile) loss of a q-quantile forecast. */
export function pinball(actual: number, predicted: number, q: number): number {
  const d = actual - predicted;
  return d >= 0 ? q * d : (q - 1) * d;
}
