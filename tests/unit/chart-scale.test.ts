import { expect, test } from 'vitest';
import { ticks } from '../../src/app/chart-scale.ts';

test('ticks are round numbers covering the range', () => {
  expect(ticks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(ticks(0, 24, 6)).toEqual([0, 5, 10, 15, 20]);
  expect(ticks(5, 5)).toEqual([5]);
  const t = ticks(-1234, 56789);
  expect(t[0]).toBeGreaterThanOrEqual(-1234);
  expect(t.at(-1)).toBeLessThanOrEqual(56789);
});
