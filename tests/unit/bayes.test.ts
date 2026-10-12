/** The Bayesian spending model's building blocks (ADR 0022, FR-BAY-001…006). */
import { describe, expect, test } from 'vitest';
import { chiSquareUniform, ess, ksUniform, pit, splitRhat } from '../../src/bayes/diagnostics.ts';
import {
  drawFromPrior,
  fitSpending,
  isFixedBill,
  predictSpending,
  spendingData,
} from '../../src/bayes/spending.ts';
import { ffbs, kfLoglik } from '../../src/forecast/ref/ffbs.ts';
import { Rng } from '../../src/lib/prng.ts';

/** log N(y; 0, Σ) by Cholesky, for a small dense Σ. */
function mvnLogDensity(y: number[], cov: number[][]): number {
  const n = y.length;
  const L = cov.map((r) => r.map(() => 0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = cov[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      L[i]![j] = i === j ? Math.sqrt(s) : s / L[j]![j]!;
    }
  const z: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = y[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * z[k]!;
    z.push(s / L[i]![i]!);
  }
  const logDet = 2 * L.reduce((a, r, i) => a + Math.log(r[i]!), 0);
  return -0.5 * (n * Math.log(2 * Math.PI) + logDet + z.reduce((a, b) => a + b * b, 0));
}

describe('Kalman filter and FFBS (FR-BAY-005)', () => {
  test('the Kalman log-likelihood equals the joint Gaussian density', () => {
    // a_1 ~ N(m0, c0), a_t = φ a_{t−1} + N(0, w), y_t = a_t + N(0, v_t).
    const phi = 0.7;
    const w = 0.3;
    const m0 = 1;
    const c0 = 2;
    const v = [0.5, 0.2, 0.9, 0.4];
    const y = [1.3, 0.2, -0.4, 0.9];
    const n = y.length;
    const varA: number[] = [c0];
    for (let t = 1; t < n; t++) varA.push(phi * phi * varA[t - 1]! + w);
    const cov = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const [a, b] = i <= j ? [i, j] : [j, i];
        return varA[a]! * phi ** (b - a) + (i === j ? v[i]! : 0);
      })
    );
    const mean = Array.from({ length: n }, (_, t) => m0 * phi ** t);
    const expected = mvnLogDensity(
      y.map((x, t) => x - mean[t]!),
      cov
    );
    expect(kfLoglik(Float64Array.from(y), Float64Array.from(v), phi, w, m0, c0)).toBeCloseTo(
      expected,
      10
    );
  });

  test('missing months add nothing to the likelihood', () => {
    const y = Float64Array.from([1, NaN, 2]);
    const v = Float64Array.from([0.5, 0.5, 0.5]);
    const withGap = kfLoglik(y, v, 1, 0.1, 0, 1);
    // Equivalent: the same two observations, two steps of drift apart.
    const twoSteps = kfLoglik(
      Float64Array.from([1, 2]),
      Float64Array.from([0.5, 0.5]),
      1,
      0.2,
      0,
      1
    );
    expect(withGap).toBeCloseTo(twoSteps, 12);
  });

  test('FFBS: exact observations come back; draws average to the smoothed path', () => {
    const y = Float64Array.from([1, 2, 3]);
    expect(
      Array.from(ffbs(y, new Float64Array(3), 1, 1, 0, 10, Float64Array.from([0.3, -1, 2])))
    ).toEqual([1, 2, 3]);
    // Symmetric data around a gap: the smoothed middle is the average.
    const rng = new Rng(4n);
    const yy = Float64Array.from([0, NaN, 2]);
    const vv = Float64Array.from([0.01, 1, 0.01]);
    let mid = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const z = Float64Array.from([rng.normal(), rng.normal(), rng.normal()]);
      mid += ffbs(yy, vv, 1, 0.5, 1, 100, z)[1]! / N;
    }
    expect(mid).toBeCloseTo(1, 1);
  });
});

describe('diagnostics (FR-BAY-006, 007)', () => {
  const chains = (n: number, m: number, f: (rng: Rng, prev: number) => number, seed = 1n) =>
    Array.from({ length: m }, (_, k) => {
      const rng = new Rng(seed + BigInt(k));
      const c = new Float64Array(n);
      let prev = 0;
      for (let i = 0; i < n; i++) c[i] = prev = f(rng, prev);
      return c;
    });

  test('independent chains: R̂ ≈ 1 and ESS ≈ the number of draws', () => {
    const c = chains(1000, 4, (r) => r.normal());
    expect(splitRhat(c)).toBeLessThan(1.01);
    expect(ess(c)).toBeGreaterThan(3200);
    expect(ess(c)).toBeLessThan(4800);
  });

  test('autocorrelated chains: ESS ≈ N(1 − ρ)/(1 + ρ)', () => {
    const rho = 0.8;
    const c = chains(5000, 4, (r, p) => rho * p + Math.sqrt(1 - rho * rho) * r.normal());
    const expected = (20_000 * (1 - rho)) / (1 + rho);
    expect(ess(c) / expected).toBeGreaterThan(0.8);
    expect(ess(c) / expected).toBeLessThan(1.25);
  });

  test('chains that disagree have a large R̂', () => {
    const c = chains(500, 4, (r) => r.normal());
    c[0] = c[0]!.map((x) => x + 2);
    expect(splitRhat(c)).toBeGreaterThan(1.1);
  });

  test('PIT spreads ties; uniform PITs pass KS and χ²', () => {
    expect(pit([0, 0, 0, 5], 0, 0)).toBe(0);
    expect(pit([0, 0, 0, 5], 0, 0.5)).toBe(0.375);
    expect(pit([1, 2, 3, 4], 10, 0.5)).toBe(1);
    const rng = new Rng(9n);
    const u = Array.from({ length: 2000 }, () => rng.float());
    expect(ksUniform(u)).toBeLessThan(0.04);
    const counts = new Array<number>(10).fill(0);
    for (const x of u) counts[Math.floor(x * 10)]!++;
    expect(chiSquareUniform(counts)).toBeLessThan(27.9);
    expect(ksUniform(u.map((x) => x * 0.5 + 0.25))).toBeGreaterThan(0.2);
  });
});

describe('the spending model (FR-BAY-001…003)', () => {
  const rng = new Rng(21n);
  const levelMean = [8, 7, 6.5];
  const values = drawFromPrior({ months: 24, firstMonth: 6, levelMean }, rng).values;
  const data = { categories: ['a', 'b', 'c'], firstMonth: 6, values };
  const light = { chains: 2, warmup: 200, draws: 100 };

  test('the same seed gives the same posterior', () => {
    const a = fitSpending(data, { seed: 5n, ...light });
    const b = fitSpending(data, { seed: 5n, ...light });
    expect(Array.from(a.sigma2)).toEqual(Array.from(b.sigma2));
    expect(Array.from(a.lambda)).toEqual(Array.from(b.lambda));
    expect(a.draws).toBe(200);
  });

  test('predictive paths: one total per path, the sum of its categories', () => {
    const post = fitSpending(data, { seed: 5n, ...light });
    const p = predictSpending(post, 6, 7n, 50);
    expect(p.total.length).toBe(300);
    for (let i = 0; i < p.total.length; i++)
      expect(p.total[i]).toBeCloseTo(
        p.categories.reduce((a, c) => a + c[i]!, 0),
        6
      );
  });

  test('fixed bills and short categories are left out of the model', () => {
    expect(isFixedBill([3000, 3000, 3000])).toBe(true);
    expect(isFixedBill([3000, 3010, 2995])).toBe(true);
    expect(isFixedBill([3000, 3500])).toBe(false);
    expect(isFixedBill([3000, 0, 3000])).toBe(false);
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const d = spendingData([
      { categoryId: 'rent', months, values: new Array<number>(12).fill(200_000) },
      { categoryId: 'food', months, values: months.map((_, i) => 50_000 + 1_000 * i) },
      { categoryId: 'rare', months, values: months.map((_, i) => (i === 3 ? 9_000 : 0)) },
    ])!;
    expect(d.categories).toEqual(['food']);
    expect(d.firstMonth).toBe(0);
  });
});
