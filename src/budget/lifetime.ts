/**
 * Replacement timing for capital assets (FR-CAP-001, FR-FC-010): Weibull
 * lifetimes with shape k and scale from the mean, conditional on current age.
 */
import { gamma, Rng, weibullScale } from '../lib/prng.ts';

/** Quantile of the remaining life (years) of an item aged `age`, Weibull(k, λ): P(T − a ≤ x | T > a) = q. */
export function remainingQuantile(q: number, k: number, scale: number, age: number): number {
  const a = Math.max(0, age);
  const t = scale * Math.pow(Math.pow(a / scale, k) - Math.log(1 - q), 1 / k);
  return Math.max(0, t - a);
}

/** Expected remaining life E[T − a | T > a], by numerical integration of the conditional survival. */
export function expectedRemaining(k: number, scale: number, age: number): number {
  const a = Math.max(0, age);
  const s0 = Math.exp(-Math.pow(a / scale, k));
  if (s0 < 1e-12) return 0;
  // ∫_a^∞ S(t)/S(a) dt with the substitution t = a + x, Simpson's rule out to the 1e-9 tail.
  const upper = remainingQuantile(1 - 1e-9, k, scale, a);
  const n = 2000;
  const h = upper / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = a + i * h;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sum += w * Math.exp(-Math.pow(t / scale, k));
  }
  return (h / 3) * (sum / s0);
}

export function meanLife(k: number, scale: number): number {
  return scale * gamma(1 + 1 / k);
}

export interface ReplacementSummary {
  ageYears: number;
  expectedRemainingYears: number;
  /** Years from now until replacement, P10/P50/P90. */
  p10: number;
  p50: number;
  p90: number;
}

export function replacementSummary(
  meanYears: number,
  shape: number,
  ageYears: number
): ReplacementSummary {
  const scale = weibullScale(meanYears, shape);
  return {
    ageYears,
    expectedRemainingYears: expectedRemaining(shape, scale, ageYears),
    p10: remainingQuantile(0.1, shape, scale, ageYears),
    p50: remainingQuantile(0.5, shape, scale, ageYears),
    p90: remainingQuantile(0.9, shape, scale, ageYears),
  };
}

/**
 * Expected number of replacements within `horizon` years for an item aged
 * `age` (a renewal process), by seeded Monte-Carlo. Deterministic for a seed.
 */
export function expectedReplacements(
  meanYears: number,
  shape: number,
  ageYears: number,
  horizon: number,
  rng: Rng,
  runs = 4000
): { count: number; byYear: number[] } {
  const scale = weibullScale(meanYears, shape);
  const byYear = new Array<number>(Math.ceil(horizon)).fill(0);
  let total = 0;
  for (let r = 0; r < runs; r++) {
    let t = rng.weibullGiven(shape, scale, Math.max(0, ageYears)) - Math.max(0, ageYears);
    while (t < horizon) {
      total++;
      byYear[Math.floor(t)]! += 1;
      t += rng.weibull(shape, scale);
    }
  }
  return { count: total / runs, byYear: byYear.map((x) => x / runs) };
}
