import { describe, expect, test } from 'vitest';
import { deriveSeed, gamma, parseSeed, Rng, weibullScale } from '../../src/lib/prng.ts';

describe('SplitMix64 (FR-SYN-001)', () => {
  test('matches the reference sequence for seed 0', () => {
    const r = new Rng(0);
    expect(r.nextU64()).toBe(0xe220a8397b1dcdafn);
    expect(r.nextU64()).toBe(0x6e789e6aa1b965f4n);
    expect(r.nextU64()).toBe(0x06c45d188009454fn);
  });

  test('accepts decimal and hex seeds, and rejects anything else', () => {
    expect(parseSeed('42')).toBe(42n);
    expect(parseSeed('0x2A')).toBe(42n);
    expect(() => parseSeed('forty-two')).toThrow(/decimal or 0x-hex/);
    expect(() => parseSeed(-1)).toThrow();
  });

  test('same seed, same stream; forks are independent and reproducible', () => {
    const a = new Rng('7');
    const b = new Rng('7');
    expect(Array.from({ length: 5 }, () => a.float())).toEqual(
      Array.from({ length: 5 }, () => b.float())
    );
    expect(new Rng(7).fork('x', 1).float()).toBe(new Rng(7).fork('x', 1).float());
    expect(new Rng(7).fork('x', 1).float()).not.toBe(new Rng(7).fork('x', 2).float());
    expect(deriveSeed(7n, 'run', 3)).toBe(deriveSeed(7n, 'run', 3));
  });

  test('distributions have the right means', () => {
    const r = new Rng(123);
    const n = 20000;
    const mean = (f: () => number) => Array.from({ length: n }, f).reduce((s, x) => s + x, 0) / n;
    expect(mean(() => r.float())).toBeCloseTo(0.5, 1);
    expect(mean(() => r.normal(3, 2))).toBeCloseTo(3, 1);
    expect(mean(() => r.poisson(2.5))).toBeCloseTo(2.5, 1);
    expect(mean(() => r.lognormalMeanCv(140, 0.25)) / 140).toBeCloseTo(1, 1);
    expect(mean(() => r.weibull(3, weibullScale(5, 3))) / 5).toBeCloseTo(1, 1);
  });

  test('conditional Weibull lifetimes exceed the current age', () => {
    const r = new Rng(9);
    for (let i = 0; i < 1000; i++) expect(r.weibullGiven(3, 5, 4)).toBeGreaterThan(4);
  });

  test('gamma', () => {
    expect(gamma(5)).toBeCloseTo(24, 9);
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 9);
  });
});
