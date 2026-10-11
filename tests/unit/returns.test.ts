import { describe, expect, test } from 'vitest';
import { Rng } from '../../src/lib/prng.ts';
import { DEFAULT_RETURN_MODELS, type ReturnModel } from '../../src/sim/model.ts';
import {
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
