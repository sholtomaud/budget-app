/** What the AI is told about a chart it drew (FR-VIZ-004): savings over time vs big purchases. */
import { describe, expect, test } from 'vitest';
import { chartFacts } from '../../src/app/charts.ts';
import type { ChartTable } from '../../src/viz/query.ts';

const base = {
  x: ['2026', '2027'],
  labels: ['2026', '2027'],
  window: null,
  perMonth: false,
  notes: [],
};

describe('chart facts', () => {
  test('savings over time: where it starts and ends', () => {
    const table: ChartTable = {
      ...base,
      series: [
        {
          label: 'Typical',
          values: [100_000, 120_000],
          unit: 'dollars',
          provenance: 'forecast',
          role: 'p50',
        },
      ],
      floor: 10_000,
    };
    const f = chartFacts({
      spec: {
        kind: 'fan',
        title: 'Savings',
        groupBy: 'year',
        series: [{ label: 'Savings', dataset: 'capital' }],
      },
      table,
      at: '',
    });
    expect(f.valuesAre).toMatch(/savings/);
    expect((f.series as Record<string, unknown>[])[0]).toMatchObject({
      atEnd: { at: '2027', value: '~$120,000' },
    });
  });

  test('big purchases (also forecast) keep their totals and what falls due', () => {
    const table: ChartTable = {
      ...base,
      series: [
        {
          label: 'Big purchases',
          values: [2_000, 0],
          unit: 'dollars',
          provenance: 'forecast',
          purchases: [
            { month: '2026-05', item: 'Laptop', categoryId: 'capex.computing', value: 2_000 },
          ],
        },
      ],
    };
    const f = chartFacts({
      spec: {
        kind: 'bar',
        title: 'Big purchases',
        groupBy: 'year',
        series: [{ label: 'Big purchases', dataset: 'big-purchases' }],
      },
      table,
      at: '',
    });
    expect(f.valuesAre).toBe('totals per period');
    const s = (f.series as Record<string, unknown>[])[0]!;
    expect(s.total).toBe('~$2,000');
    expect(s.fallsDue).toEqual([{ when: '2026-05', item: 'Laptop', cost: '~$2,000' }]);
  });
});
