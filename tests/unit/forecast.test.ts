import { describe, expect, test } from 'vitest';
import { forecastCapex } from '../../src/forecast/capex.ts';
import { forecastOpex, inflate } from '../../src/forecast/opex.ts';
import { backtest, choose } from '../../src/forecast/ref/backtest.ts';
import { bootstrapPaths, pathQuantiles } from '../../src/forecast/ref/bootstrap.ts';
import {
  crostonRun,
  ets,
  etsRun,
  meanMethod,
  seasonalNaive,
  tsb,
} from '../../src/forecast/ref/methods.ts';
import { mase, pinball, quantileSorted } from '../../src/forecast/ref/stats.ts';
import { coveredMonths, monthlySeries } from '../../src/forecast/series.ts';
import { Rng } from '../../src/lib/prng.ts';
import type { Asset, Txn } from '../../src/domain/types.ts';

const seasonal = (n: number, noise = 0, seed = 1) => {
  const r = new Rng(seed);
  return Float64Array.from(
    { length: n },
    (_, t) => 100 + 30 * Math.sin((2 * Math.PI * t) / 12) + 0.5 * t + noise * r.normal()
  );
};

describe('stats', () => {
  test('quantiles, MASE, pinball', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([5], 0.9)).toBe(5);
    expect(mase([2, 4], [2, 4], [1, 2, 3], 12)).toBe(0);
    expect(mase([3], [1], [1, 2, 3], 12)).toBeCloseTo(2, 12);
    expect(pinball(10, 8, 0.9)).toBeCloseTo(1.8, 12);
    expect(pinball(8, 10, 0.9)).toBeCloseTo(0.2, 12);
  });
});

describe('methods (§10.1)', () => {
  test('seasonal naive repeats last season; naive when short', () => {
    const y = Float64Array.from({ length: 24 }, (_, i) => i % 12);
    expect(Array.from(seasonalNaive(y, 3, 12).forecast)).toEqual([0, 1, 2]);
    expect(seasonalNaive(Float64Array.from([1, 2, 3]), 2, 12).method).toBe('naive');
  });

  test('ETS recovers a clean seasonal series', () => {
    const y = seasonal(48);
    const f = ets(y.subarray(0, 36), 12, 12);
    expect(ets(y.subarray(0, 30), 3, 12).method).toBe('holt-damped');
    expect(f.method).toBe('ets-additive-damped');
    expect(mase(y.subarray(36), f.forecast, y.subarray(0, 36), 12)).toBeLessThan(0.3);
    // Without three seasons it drops the seasonal part.
    expect(ets(y.subarray(0, 20), 3, 12).method).toBe('holt-damped');
  });

  test('ETS with zero smoothing and no trend reproduces its initial level', () => {
    const y = Float64Array.from({ length: 30 }, () => 50);
    const r = etsRun(y, 3, 12, 0, 0, 0, 0.9, true);
    expect(Array.from(r.forecast)).toEqual([50, 50, 50]);
  });

  test('Croston family on intermittent demand', () => {
    const y = Float64Array.from([0, 0, 10, 0, 0, 0, 10, 0, 0, 10, 0, 0]);
    const c = crostonRun(y, 2, 0.1, 0.1, 'croston');
    expect(c.forecast[0]).toBeGreaterThan(2);
    expect(c.forecast[0]).toBeLessThan(5);
    expect(crostonRun(y, 1, 0.1, 0.1, 'sba').forecast[0]).toBeLessThan(c.forecast[0]!);
    expect(tsb(y, 3, 12).forecast[0]).toBeGreaterThan(0);
    expect(Array.from(crostonRun(new Float64Array(6), 2, 0.1, 0.1, 'croston').forecast)).toEqual([
      0, 0,
    ]);
  });

  test('backtest picks ETS for a seasonal series and the mean for white noise', () => {
    const opts = { m: 12, h: 3, minTrain: 24, seed: 7n };
    expect(choose(seasonal(60, 2), { ...opts, minTrain: 36 }).chosen).toBe('ets');
    const noise = new Rng(3);
    const flat = Float64Array.from({ length: 36 }, () => 100 + 20 * noise.normal());
    const c = choose(flat, { ...opts, minTrain: 12 });
    expect(['mean', 'ets']).toContain(c.chosen);
    const score = (k: string) => c.scores.find((s) => s.method === k)!.mase;
    expect(score(c.chosen)).toBeLessThan(score('seasonal-naive'));
    const b = backtest(flat, meanMethod, { ...opts, minTrain: 12 });
    expect(b.origins).toBe(24);
    expect(b.pinball).toBeGreaterThan(0);
  });
});

describe('bootstrap', () => {
  test('quantiles are ordered, non-negative and deterministic for a seed', () => {
    const fit = ets(seasonal(36, 5), 12, 12);
    const a = pathQuantiles(bootstrapPaths(fit, 12, 500, new Rng(1)), 12);
    const b = pathQuantiles(bootstrapPaths(fit, 12, 500, new Rng(1)), 12);
    expect(a).toEqual(b);
    for (let i = 0; i < 12; i++) {
      for (let k = 1; k < a.length; k++) expect(a[k]![i]).toBeGreaterThanOrEqual(a[k - 1]![i]!);
      expect(a[0]![i]).toBeGreaterThanOrEqual(0);
    }
    // Uncertainty widens with the horizon.
    expect(a[6]![11]! - a[0]![11]!).toBeGreaterThan(a[6]![0]! - a[0]![0]!);
  });
});

const tx = (
  date: string,
  amount: bigint,
  categoryId: string,
  kind: 'opex' | 'capex' | 'transfer' = 'opex'
): Txn => ({
  id: `${date}/${amount}/${categoryId}`,
  accountId: 'SYN-A',
  idSynthetic: false,
  status: 'POSTED',
  cdrType: 'PAYMENT',
  date,
  amount,
  currency: 'AUD',
  description: '',
  importIds: [],
  provenance: 'illustrative',
  classification: { kind, categoryId, confidence: 1, by: 'user' },
});

describe('series and OPEX forecast (FR-FC-001)', () => {
  test('monthly series cover only complete months and exclude capex and transfers', () => {
    const txns = [
      tx('2024-07-10', -1000n, 'food.cafe'),
      tx('2024-08-01', -500n, 'food.cafe'),
      tx('2024-09-30', -700n, 'food.cafe'),
      tx('2024-08-05', -99999n, 'capex.computing', 'capex'),
    ];
    expect(coveredMonths(txns)).toEqual(['2024-08', '2024-09']);
    expect(monthlySeries(txns)).toEqual([
      { categoryId: 'food.cafe', months: ['2024-08', '2024-09'], values: [500, 700] },
    ]);
  });

  test('short histories fall back to the budget, labelled budgeted', () => {
    const history = [
      { categoryId: 'food.cafe', months: ['2025-01', '2025-02'], values: [100, 120] },
    ];
    const f = forecastOpex(
      history,
      { 'food.cafe': 400, 'housing.rent': 2000 },
      { horizon: 6, seed: 1n }
    );
    expect(f.months[0]).toBe('2025-03');
    const cafe = f.series.find((s) => s.categoryId === 'food.cafe')!;
    expect(cafe).toMatchObject({ provenance: 'budgeted', method: 'budget' });
    expect(cafe.quantiles.p50).toEqual([400, 400, 400, 400, 400, 400]);
    expect(f.total.p50[0]).toBe(2400);
  });

  test('long histories are forecast, with ordered quantiles and a total', () => {
    const r = new Rng(5);
    const months = Array.from(
      { length: 24 },
      (_, i) => `20${24 + Math.floor((i + 6) / 12)}-${String(((i + 6) % 12) + 1).padStart(2, '0')}`
    );
    const history = [
      { categoryId: 'food.groceries', months, values: months.map(() => 60000 + 8000 * r.normal()) },
      { categoryId: 'housing.rent', months, values: months.map(() => 268667) },
    ];
    const f = forecastOpex(history, {}, { horizon: 12, seed: 9n });
    const g = f.series.find((s) => s.categoryId === 'food.groceries')!;
    expect(g.provenance).toBe('forecast');
    expect(g.quantiles.p5[0]!).toBeLessThan(g.quantiles.p95[0]!);
    expect(f.series.find((s) => s.categoryId === 'housing.rent')!.quantiles.p50[0]).toBeCloseTo(
      268667,
      0
    );
    expect(f.total.p50[0]!).toBeGreaterThan(268667);
    expect(forecastOpex(history, {}, { horizon: 12, seed: 9n })).toEqual(f);
    expect(inflate([100, 100], 0.12)[1]).toBeCloseTo(100 * Math.pow(1.12, 2 / 12), 9);
  });
});

describe('CAPEX forecast (FR-FC-010)', () => {
  const laptop: Asset = {
    id: 'laptop',
    name: 'Laptop',
    categoryId: 'capex.computing',
    purchasedAt: '2022-07-01',
    cost: { minor: 300000n, ccy: 'AUD' },
    life: { meanYears: 4, shape: 3 },
    lifeAssumed: false,
    replace: true,
    status: 'owned',
    linkedTxnIds: [],
    provenance: 'illustrative',
  };

  test('expected spend over a long horizon ≈ cost / life per year, and cumulative quantiles are monotone', () => {
    const f = forecastCapex([laptop], { start: '2025-07-01', horizon: 240, seed: 3n, runs: 2000 });
    const perYear = (f.mean.reduce((a, b) => a + b, 0) / 240) * 12;
    expect(perYear / (300000 / 4)).toBeCloseTo(1, 1);
    for (let i = 1; i < 240; i++)
      expect(f.cumulative.p50[i]!).toBeGreaterThanOrEqual(f.cumulative.p50[i - 1]!);
  });

  test('wish-list decisions: buy by a date counts once; deferred and dropped never', () => {
    const wish: Asset = {
      ...laptop,
      id: 'watch',
      status: 'wish',
      purchasedAt: undefined,
      cost: { minor: 90000n, ccy: 'AUD' },
      decision: { action: 'buy', by: '2026-01-15' },
    };
    const f = forecastCapex([wish], { start: '2025-07-01', horizon: 12, seed: 1n, runs: 100 });
    expect(f.mean[6]).toBe(90000);
    expect(f.mean.reduce((a, b) => a + b, 0)).toBe(90000);
    expect(
      forecastCapex([{ ...wish, decision: { action: 'defer' } }], {
        start: '2025-07-01',
        horizon: 12,
        seed: 1n,
        runs: 100,
      }).mean.every((x) => x === 0)
    ).toBe(true);
  });
});
