import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticks } from '../../src/app/chart-scale.ts';

test('ticks are round numbers covering the range', () => {
  assert.deepEqual(ticks(0, 100), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(ticks(0, 24, 6), [0, 5, 10, 15, 20]);
  assert.deepEqual(ticks(5, 5), [5]);
  const t = ticks(-1234, 56789);
  assert.ok(t[0]! >= -1234 && t.at(-1)! <= 56789);
});
