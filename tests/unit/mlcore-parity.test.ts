/**
 * ml-core (WASM) against the TypeScript reference: within 1e-9 relative on
 * random inputs (SPEC §15.2). Build first: npm run mlcore:build.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { tsKernels, useKernels } from '../../src/forecast/kernels.ts';
import { forecastOpex } from '../../src/forecast/opex.ts';
import { loadMlCore, type MlCore } from '../../src/forecast/mlcore.ts';
import { mase, pinball, quantileSorted } from '../../src/forecast/ref/stats.ts';
import { Rng } from '../../src/lib/prng.ts';
import { tsCma } from '../../src/optimise/cmaes.ts';
import { defaultLambda } from '../../src/optimise/ref/cmaes.ts';
import { forAll } from '../property/prop.ts';

let ml: MlCore;

beforeAll(async () => {
  const bytes = readFileSync(new URL('../../src/forecast/ml-core.wasm', import.meta.url));
  ml = await loadMlCore(bytes);
});

const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
function expectClose(a: ArrayLike<number>, b: ArrayLike<number>, what: string) {
  expect(a.length, what).toBe(b.length);
  for (let i = 0; i < a.length; i++)
    if (!close(a[i]!, b[i]!)) throw new Error(`${what}[${i}]: ${a[i]} vs ${b[i]}`);
}

const series = (rng: Rng, n: number, intermittent = false) =>
  Float64Array.from({ length: n }, (_, t) =>
    intermittent && rng.chance(0.6)
      ? 0
      : Math.max(0, 1000 + 300 * Math.sin(t / 2) + 200 * rng.normal() + 5 * t)
  );

describe('ml-core parity (§15.2)', () => {
  test('SplitMix64 floats are bit-identical', () => {
    const r = new Rng(12345n);
    expect(Array.from(ml.uniform(12345n, 1000))).toEqual(
      Array.from({ length: 1000 }, () => r.float())
    );
  });

  test('conditional Weibull samples', () => {
    const r = new Rng(9n);
    expectClose(
      ml.weibullGiven(9n, 3, 5.6, 2.5, 500),
      Array.from({ length: 500 }, () => r.weibullGiven(3, 5.6, 2.5)),
      'weibull'
    );
  });

  test('Holt–Winters runs, seasonal and not', async () => {
    await forAll(40, 'parity-ets', (rng) => {
      const n = 12 + rng.int(60);
      const y = series(rng, n);
      const seasonal = n >= 24 && rng.chance(0.5);
      const args = [
        y,
        1 + rng.int(24),
        12,
        rng.uniform(0, 1),
        rng.uniform(0, 0.3),
        rng.uniform(0, 0.3),
        rng.uniform(0.8, 1),
        seasonal,
      ] as const;
      const a = ml.etsRun(...args);
      const b = tsKernels.etsRun(...args);
      expectClose(a.forecast, b.forecast, 'forecast');
      expectClose(a.residuals, b.residuals, 'residuals');
      expect(close(a.sse, b.sse)).toBe(true);
    });
  });

  test('Croston, SBA and TSB', async () => {
    await forAll(40, 'parity-croston', (rng) => {
      const y = series(rng, 6 + rng.int(40), true);
      const variant = rng.pick(['croston', 'sba', 'tsb'] as const);
      const alpha = rng.uniform(0.05, 0.4);
      const beta = rng.uniform(0.05, 0.4);
      const a = ml.crostonRun(y, 6, alpha, beta, variant);
      const b = tsKernels.crostonRun(y, 6, alpha, beta, variant);
      expectClose(a.forecast, b.forecast, 'forecast');
      expectClose(a.residuals, b.residuals, 'residuals');
      expect(close(a.sse, b.sse)).toBe(true);
    });
  });

  test('bootstrap paths and their quantiles', async () => {
    await forAll(10, 'parity-bootstrap', (rng) => {
      const h = 1 + rng.int(24);
      const forecast = Float64Array.from({ length: h }, () => rng.uniform(0, 2000));
      const residuals = Float64Array.from({ length: rng.int(40) }, () => rng.normal(0, 300));
      const seed = rng.nextU64();
      const a = ml.bootstrapPaths(forecast, residuals, 300, seed);
      const b = tsKernels.bootstrapPaths(forecast, residuals, 300, seed);
      expectClose(a, b, 'paths');
      const qa = ml.pathQuantiles(a, h);
      const qb = tsKernels.pathQuantiles(b, h);
      qa.forEach((q, k) => expectClose(q, qb[k]!, `q${k}`));
    });
  });

  test('scores: MASE, pinball, quantiles', async () => {
    await forAll(30, 'parity-scores', (rng) => {
      const train = series(rng, 6 + rng.int(40));
      const actual = series(rng, 1 + rng.int(12));
      const fc = Float64Array.from(actual, (v) => v + rng.normal(0, 100));
      expect(close(ml.mase(actual, fc, train, 12), mase(actual, fc, train, 12))).toBe(true);
      const sorted = Float64Array.from(train).sort();
      const q = rng.float();
      expect(close(ml.quantileSorted(sorted, q), quantileSorted(sorted, q))).toBe(true);
      expect(close(ml.pinball(actual[0]!, fc[0]!, q), pinball(actual[0]!, fc[0]!, q))).toBe(true);
    });
  });

  test('a whole OPEX forecast is the same on either kernel set', () => {
    const r = new Rng(77);
    const months = Array.from(
      { length: 30 },
      (_, i) => `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
    );
    const history = ['a', 'b', 'c'].map((categoryId, j) => ({
      categoryId,
      months,
      values: months.map((_, i) =>
        Math.max(0, 1000 * (j + 1) + 200 * r.normal() + (j === 2 && i % 3 ? -5000 : 0))
      ),
    }));
    const viaTs = forecastOpex(history, {}, { horizon: 12, seed: 5n });
    useKernels(ml);
    try {
      const viaWasm = forecastOpex(history, {}, { horizon: 12, seed: 5n });
      expect(viaWasm.series.map((s) => s.method)).toEqual(viaTs.series.map((s) => s.method));
      expectClose(viaWasm.total.p50, viaTs.total.p50, 'total p50');
      expectClose(viaWasm.total.p95, viaTs.total.p95, 'total p95');
    } finally {
      useKernels(tsKernels);
    }
  });

  test('CMA-ES ask/tell agrees step by step (SPEC §11.4)', () => {
    return forAll(20, 'cma-es', (rng) => {
      const n = 1 + rng.int(5);
      const lambda = defaultLambda(n) + rng.int(4);
      const x0 = Float64Array.from({ length: n }, () => rng.uniform(-1, 1));
      const target = Float64Array.from({ length: n }, () => rng.uniform(-1, 1));
      let a = tsCma.init(x0, 0.4, lambda);
      let b = ml.cma.init(x0, 0.4, lambda);
      expectClose(b, a, 'init');
      for (let g = 0; g < 8; g++) {
        const z = Float64Array.from({ length: lambda * n }, () => rng.normal());
        const xa = tsCma.ask(a, z);
        const xb = ml.cma.ask(b, z);
        expectClose(xb, xa, `ask ${g}`);
        const f = Float64Array.from({ length: lambda }, (_, k) => {
          let s = 0;
          for (let i = 0; i < n; i++) s += (xa[k * n + i]! - target[i]!) ** 2 * (i + 1);
          return s;
        });
        a = tsCma.tell(a, xa, f);
        b = ml.cma.tell(b, xb, f);
        expectClose(b, a, `tell ${g}`);
      }
    });
  });
  test('FFBS and the Kalman log-likelihood match (ADR 0022)', async () => {
    await forAll(60, 'parity-ffbs', (rng) => {
      const n = 2 + rng.int(60);
      const y = Float64Array.from({ length: n }, () => (rng.chance(0.15) ? NaN : rng.normal(6, 1)));
      const v = Float64Array.from({ length: n }, () =>
        rng.chance(0.05) ? Infinity : rng.uniform(0.001, 1)
      );
      const z = Float64Array.from({ length: n }, () => rng.normal());
      const phi = rng.chance(0.5) ? 1 : rng.uniform(0, 0.95);
      const w = rng.uniform(1e-6, 0.2);
      const m0 = rng.normal(6, 1);
      const c0 = rng.uniform(0.1, 2);
      expectClose(
        ml.ffbs(y, v, phi, w, m0, c0, z),
        tsKernels.ffbs(y, v, phi, w, m0, c0, z),
        'ffbs'
      );
      const a = ml.kfLoglik(y, v, phi, w, m0, c0);
      const b = tsKernels.kfLoglik(y, v, phi, w, m0, c0);
      if (!close(a, b)) throw new Error(`kfLoglik: ${a} vs ${b}`);
    });
  });
});
