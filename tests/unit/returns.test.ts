import { describe, expect, test } from 'vitest';
import { Rng } from '../../src/lib/prng.ts';
import { DEFAULT_RETURN_MODELS, type ReturnModel } from '../../src/sim/model.ts';
import {
  drawLogParams,
  HISTORY_MONTHS,
  monthlyFixed,
  sampleReturnPaths,
  syntheticHistories,
  unitStudentT,
} from '../../src/sim/returns.ts';

const annualise = (path: Float64Array) => {
  const years: number[] = [];
  for (let y = 0; y + 12 <= path.length; y += 12) {
    let g = 1;
    for (let m = y; m < y + 12; m++) g *= 1 + path[m]!;
    years.push(g - 1);
  }
  const mean = years.reduce((a, b) => a + b, 0) / years.length;
  const sd = Math.sqrt(years.reduce((a, b) => a + (b - mean) ** 2, 0) / (years.length - 1));
  return { mean, sd };
};

describe('return samplers (FR-FC-020)', () => {
  test('fixed compounds to exactly the annual rate', () => {
    let g = 1;
    for (let i = 0; i < 12; i++) g *= 1 + monthlyFixed(0.05);
    expect(g - 1).toBeCloseTo(0.05, 12);
  });

  test('lognormal matches its annual mean and volatility', () => {
    const m: ReturnModel = {
      id: 'x',
      kind: 'lognormal',
      mu: 0.06,
      sigma: 0.15,
      incomeYield: 0,
      label: '',
    };
    const { mean, sd } = annualise(sampleReturnPaths([m], 12 * 20_000, 7n).x!);
    expect(mean).toBeCloseTo(0.06, 2);
    expect(sd).toBeCloseTo(0.15, 2);
  });

  test('Student-t is scaled to unit variance and has fat tails', () => {
    const rng = new Rng(3n);
    const xs = Array.from({ length: 200_000 }, () => unitStudentT(rng, 4));
    const v = xs.reduce((a, x) => a + x * x, 0) / xs.length;
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1.1);
    const tail = xs.filter((x) => Math.abs(x) > 4).length / xs.length;
    expect(tail).toBeGreaterThan(0.0005); // a normal gives 6e-5
  });

  test('every return is above −100 %', () => {
    const paths = sampleReturnPaths(DEFAULT_RETURN_MODELS, 1200, 11n);
    for (const p of Object.values(paths)) for (const r of p) expect(r).toBeGreaterThan(-1);
  });

  test('bootstrap models draw the same history months (joint)', () => {
    const models: ReturnModel[] = [
      {
        id: 'a',
        kind: 'block-bootstrap',
        seriesId: 'synthetic-equity',
        block: 12,
        incomeYield: 0,
        label: '',
      },
      {
        id: 'b',
        kind: 'block-bootstrap',
        seriesId: 'synthetic-btc',
        block: 12,
        incomeYield: 0,
        label: '',
      },
    ];
    const p = sampleReturnPaths(models, 120, 5n);
    const h = syntheticHistories();
    expect(h['synthetic-equity']!.length).toBe(HISTORY_MONTHS);
    const near = (xs: Float64Array, v: number) => xs.findIndex((x) => Math.abs(x - v) < 1e-12);
    for (let i = 0; i < 120; i++) {
      const ia = near(h['synthetic-equity']!, Math.log1p(p.a![i]!));
      const ib = near(h['synthetic-btc']!, Math.log1p(p.b![i]!));
      expect(ia).toBeGreaterThanOrEqual(0);
      expect(ia).toBe(ib);
    }
  });

  test('deterministic per seed, different across seeds (NFR-DET-001)', () => {
    const a = sampleReturnPaths(DEFAULT_RETURN_MODELS, 60, 1n);
    const b = sampleReturnPaths(DEFAULT_RETURN_MODELS, 60, 1n);
    const c = sampleReturnPaths(DEFAULT_RETURN_MODELS, 60, 2n);
    expect(Array.from(a.equity!)).toEqual(Array.from(b.equity!));
    expect(Array.from(a.equity!)).not.toEqual(Array.from(c.equity!));
  });
});

describe('return-parameter uncertainty (FR-BAY-004)', () => {
  test('the posterior draw centres on the estimate, with the textbook spread', () => {
    const rng = new Rng(11n);
    const n = 120;
    const ms: number[] = [];
    const s2s: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const d = drawLogParams(rng, 0.005, 0.04, n);
      ms.push(d.m);
      s2s.push(d.s * d.s);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sdM = Math.sqrt(mean(ms.map((m) => (m - mean(ms)) ** 2)));
    expect(mean(ms)).toBeCloseTo(0.005, 3);
    // sd of the mean ≈ s/√n, inflated slightly by σ's own uncertainty (Student-t).
    expect(sdM / (0.04 / Math.sqrt(n))).toBeGreaterThan(0.97);
    expect(sdM / (0.04 / Math.sqrt(n))).toBeLessThan(1.05);
    // E[σ²] = s²(n−1)/(n−3) for the scaled inverse-χ².
    expect(mean(s2s) / ((0.04 ** 2 * (n - 1)) / (n - 3))).toBeCloseTo(1, 1);
  });

  const lognormal: ReturnModel = {
    id: 'eq',
    kind: 'lognormal',
    mu: 0.05,
    sigma: 0.16,
    incomeYield: 0,
    label: '',
  };
  /** Total log growth over 30 years, per run. */
  const growth = (models: ReturnModel[], id: string, uncertain: boolean) =>
    Array.from({ length: 3000 }, (_, run) => {
      const p = sampleReturnPaths(models, 360, BigInt(run + 1), {
        parameterUncertainty: uncertain,
      })[id]!;
      let g = 0;
      for (const r of p) g += Math.log(1 + r);
      return g;
    });
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };

  test('over 30 years, uncertainty about the average widens the outcomes', () => {
    const plain = sd(growth([lognormal], 'eq', false));
    const unsure = sd(growth([lognormal], 'eq', true));
    // 30 years of evidence about the mean adds about as much variance again
    // as 30 years of noise: the spread grows by roughly √2.
    expect(unsure / plain).toBeGreaterThan(1.3);
    expect(unsure / plain).toBeLessThan(1.6);
  });

  test('bootstrap histories keep their months, re-centred and re-scaled per run', () => {
    const boot = DEFAULT_RETURN_MODELS.find((m) => m.kind === 'block-bootstrap')!;
    const a = sampleReturnPaths([boot], 240, 5n)[boot.id]!;
    const b = sampleReturnPaths([boot], 240, 5n, { parameterUncertainty: true })[boot.id]!;
    // Same months drawn, so the log returns are an exact affine map of each other.
    const la = Array.from(a, (r) => Math.log(1 + r));
    const lb = Array.from(b, (r) => Math.log(1 + r));
    const k = (lb[1]! - lb[0]!) / (la[1]! - la[0]!);
    for (let i = 2; i < 240; i++) expect(lb[i]! - lb[0]!).toBeCloseTo(k * (la[i]! - la[0]!), 9);
    expect(k).toBeGreaterThan(0);
  });

  test('fixed models, frozen runs and runs without the option are unchanged', () => {
    const fixed = DEFAULT_RETURN_MODELS.find((m) => m.kind === 'fixed')!;
    const on = { parameterUncertainty: true };
    expect(sampleReturnPaths([fixed], 24, 3n, on)).toEqual(sampleReturnPaths([fixed], 24, 3n));
    expect(sampleReturnPaths([lognormal], 24, 3n, { ...on, frozen: true })).toEqual(
      sampleReturnPaths([lognormal], 24, 3n, { frozen: true })
    );
    expect(sampleReturnPaths([lognormal], 24, 3n, on)).toEqual(
      sampleReturnPaths([lognormal], 24, 3n, on)
    );
  });
});
