import { describe, expect, test } from 'vitest';
import { historyModel, parsePriceHistory, realLogReturns } from '../../src/sim/history.ts';

/** A synthetic daily price series: +1 % a month, compounded. */
function csv(months: number, header = 'Date,Open,High,Low,Close,Adj Close,Volume'): string {
  const lines = [header];
  let p = 100;
  for (let i = 0; i < months; i++) {
    const y = 2020 + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, '0');
    for (const d of ['03', '15', '27'])
      lines.push(`${y}-${m}-${d},0,0,0,${p - 1},${p.toFixed(6)},1`);
    p *= 1.01;
  }
  return lines.join('\n');
}

describe('imported price histories (FR-FC-020)', () => {
  test('month-end closes become monthly log returns; Adj Close preferred', () => {
    const h = parsePriceHistory(csv(36), 'prices.csv', 'Test index');
    expect(h.logReturns).toHaveLength(35);
    for (const r of h.logReturns) expect(r).toBeCloseTo(Math.log(1.01), 6);
    expect(h.months[0]).toBe('2020-02');
    expect(historyModel(h)).toMatchObject({ kind: 'block-bootstrap', seriesId: 'user:test-index' });
  });

  test('deflated to real terms by CPI', () => {
    const h = parsePriceHistory(csv(36), 'p.csv', 'X');
    const real = realLogReturns(h, 0.03);
    expect(real[0]).toBeCloseTo(Math.log(1.01) - Math.log(1.03) / 12, 12);
  });

  test('too short or wrong columns are refused', () => {
    expect(() => parsePriceHistory(csv(12), 'p.csv', 'X')).toThrow('at least 25 months');
    expect(() => parsePriceHistory('When,Amount\n2020-01-01,1', 'p.csv', 'X')).toThrow(
      'date column'
    );
  });
});
