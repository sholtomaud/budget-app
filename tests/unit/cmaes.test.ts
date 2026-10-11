import { describe, expect, test } from 'vitest';
import { Rng } from '../../src/lib/prng.ts';
import { tsCma } from '../../src/optimise/cmaes.ts';
import { cmaesMean, defaultLambda, HEADER } from '../../src/optimise/ref/cmaes.ts';

function minimise(f: (x: Float64Array) => number, x0: number[], gens: number, seed = 1n) {
  const n = x0.length;
  const lambda = defaultLambda(n);
  const rng = new Rng(seed);
  let s = tsCma.init(Float64Array.from(x0), 0.5, lambda);
  for (let g = 0; g < gens; g++) {
    const z = Float64Array.from({ length: lambda * n }, () => rng.normal());
    const xs = tsCma.ask(s, z);
    const fs = Float64Array.from({ length: lambda }, (_, k) => f(xs.subarray(k * n, (k + 1) * n)));
    s = tsCma.tell(s, xs, fs);
  }
  return s;
}

describe('CMA-ES reference (SPEC §11.4)', () => {
  test('finds the minimum of a shifted sphere', () => {
    const t = [0.3, -0.2, 0.5, 0.1];
    const s = minimise((x) => x.reduce((a, v, i) => a + (v - t[i]!) ** 2, 0), [0, 0, 0, 0], 150);
    Array.from(cmaesMean(s)).forEach((v, i) => expect(v).toBeCloseTo(t[i]!, 4));
  });

  test('learns a rotated, ill-conditioned ellipsoid', () => {
    // f = 1e4·(x0 + x1)² + (x0 − x1)²: the valley lies along a diagonal.
    const s = minimise((x) => 1e4 * (x[0]! + x[1]!) ** 2 + (x[0]! - x[1]! - 1) ** 2, [1, 1], 200);
    const m = cmaesMean(s);
    expect(m[0]!).toBeCloseTo(0.5, 3);
    expect(m[1]!).toBeCloseTo(-0.5, 3);
  });

  test('tell does not mutate the caller’s state; the generation counts up', () => {
    const s0 = tsCma.init(Float64Array.from([0, 0]), 0.3, 6);
    const copy = s0.slice();
    const xs = tsCma.ask(s0, new Float64Array(12).fill(0.1));
    const s1 = tsCma.tell(s0, xs, Float64Array.from([3, 1, 2, 6, 5, 4]));
    expect(Array.from(s0)).toEqual(Array.from(copy));
    expect(s1[4]).toBe(1);
    expect(HEADER).toBe(12);
  });
});
