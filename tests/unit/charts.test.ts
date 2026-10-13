/** Charts in the chat: specs, their checks, the queries and the CSV (FR-VIZ-001…006, ADR 0028). */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { matchChart, matchIntent } from '../../src/assistant/intents.ts';
import type { BudgetLine } from '../../src/budget/model.ts';
import { DEFAULT_PERIODS } from '../../src/budget/periods.ts';
import type { Category } from '../../src/classify/categories.ts';
import type { ClassificationKind, Txn } from '../../src/domain/types.ts';
import { validate } from '../../src/lib/jsonschema.ts';
import { runChart, tableCsv, type QueryContext } from '../../src/viz/query.ts';
import { specFromRequest, topicCategories } from '../../src/viz/requests.ts';
import {
  CHART_SCHEMA,
  CHART_TOOL_SCHEMA,
  checkSpec,
  withoutNulls,
  type ChartSpec,
} from '../../src/viz/spec.ts';

let n = 0;
function txn(
  date: string,
  dollars: number,
  categoryId: string,
  kind: ClassificationKind,
  merchant?: string
): Txn {
  return {
    id: `t${++n}`,
    accountId: 'SYN-A',
    idSynthetic: false,
    status: 'POSTED',
    cdrType: 'PAYMENT',
    date,
    amount: BigInt(Math.round(dollars * 100)),
    currency: 'AUD',
    description: merchant ?? categoryId,
    ...(merchant ? { merchantName: merchant } : {}),
    importIds: ['i1'],
    provenance: 'illustrative',
    classification: { kind, categoryId, confidence: 1, by: 'rule' },
  };
}

const categories: Category[] = [
  { id: 'food', name: 'Food', kind: 'opex' },
  { id: 'food.groceries', name: 'Groceries', kind: 'opex' },
  { id: 'food.cafes', name: 'Cafes', kind: 'opex' },
  { id: 'transport.fuel', name: 'Fuel', kind: 'opex' },
  { id: 'income.salary', name: 'Salary', kind: 'income' },
];

const months = ['2025-01', '2025-02', '2025-03'];
const txns: Txn[] = months.flatMap((m, i) => [
  txn(`${m}-01`, 3000, 'income.salary', 'income'),
  txn(`${m}-02`, -100 - i * 10, 'food.groceries', 'opex', 'Fresh Mart'),
  txn(`${m}-15`, -20, 'food.cafes', 'opex', 'Bean There'),
  txn(`${m}-16`, -20, 'food.cafes', 'opex', 'Bean There'),
  txn(`${m}-28`, -60, 'transport.fuel', 'opex', '=HYPERLINK("x")'),
]);
// Data runs to the month's end, so March is complete.
txns.push(txn('2025-03-31', -1, 'food.cafes', 'opex', 'Bean There'));

const line: BudgetLine = {
  id: 'l1',
  categoryId: 'food.groceries',
  item: 'Groceries',
  cost: 2500n,
  ccy: 'AUD',
  period: 'w',
  tierMultiplier: {},
};
const ctx: QueryContext = {
  txns,
  categories,
  lines: [line],
  periods: DEFAULT_PERIODS,
  tier: 'secure',
};

const spec = (s: Partial<ChartSpec>): ChartSpec => ({
  kind: 'bar',
  title: 'T',
  groupBy: 'month',
  series: [{ label: 'Spending', dataset: 'spending' }],
  ...s,
});

describe('chart specs are checked before anything is drawn', () => {
  test('the published schema is the one the code uses', () => {
    const file = JSON.parse(readFileSync('schemas/chart-spec.schema.json', 'utf8'));
    delete file.$schema;
    delete file.title;
    expect(file).toEqual(JSON.parse(JSON.stringify(CHART_SCHEMA)));
  });

  test('a good spec passes', () => {
    expect(checkSpec(spec({ kind: 'line' }))).toBeNull();
  });

  test('shape: unknown kinds, datasets and fields are refused', () => {
    expect(checkSpec(spec({ kind: 'pie' as never }))).toMatch(/kind/);
    expect(checkSpec(spec({ series: [{ label: 'x', dataset: 'net-worth' as never }] }))).toMatch(
      /dataset/
    );
    expect(checkSpec({ ...spec({}), values: [1, 2, 3] })).toMatch(/not an allowed property/);
    expect(
      checkSpec(spec({ series: [{ label: 'x', dataset: 'spending', value: 5 } as never] }))
    ).toMatch(/not an allowed property/);
    expect(checkSpec(spec({ series: [] }))).toMatch(/at least 1/);
    expect(checkSpec('a chart')).not.toBeNull();
  });

  test('limits the providers do not enforce', () => {
    expect(checkSpec(spec({ title: 'x'.repeat(81) }))).toMatch(/longer than 80/);
    const seven = Array.from({ length: 7 }, () => ({ label: 's', dataset: 'spending' as const }));
    expect(checkSpec(spec({ series: seven }))).toMatch(/at most 6/);
    expect(
      checkSpec(
        spec({ series: [{ label: 's', dataset: 'spending', filter: { from: '2025-13' } }] })
      )
    ).toMatch(/does not match/);
    expect(
      checkSpec(spec({ series: [{ label: 's', dataset: 'spending', filter: { lastMonths: 0 } }] }))
    ).toMatch(/≥ 1/);
  });

  test('rules the schema cannot say', () => {
    expect(checkSpec(spec({ kind: 'line', groupBy: 'category' }))).toMatch(/time axis/);
    expect(
      checkSpec(spec({ series: [{ label: 'b', dataset: 'budget', measure: 'count' }] }))
    ).toMatch(/rate/);
    expect(
      checkSpec(spec({ groupBy: 'merchant', series: [{ label: 'b', dataset: 'budget' }] }))
    ).toMatch(/no merchant/);
    expect(
      checkSpec(
        spec({
          series: [{ label: 's', dataset: 'spending', filter: { from: '2025-03', to: '2025-01' } }],
        })
      )
    ).toMatch(/backwards/);
  });

  test('markup in text is just text: allowed, and never parsed (the renderer uses textContent)', () => {
    expect(checkSpec(spec({ title: '<script>alert(1)</script>' }))).toBeNull();
  });

  test('a strict tool answer, without its nulls, is a spec', () => {
    const answer = {
      kind: 'line',
      title: 'Groceries',
      caption: null,
      groupBy: 'month',
      series: [
        {
          label: 'Spending',
          dataset: 'spending',
          measure: null,
          filter: {
            categories: ['food.groceries'],
            text: null,
            from: null,
            to: null,
            lastMonths: 12,
          },
        },
      ],
    };
    expect(validate(CHART_TOOL_SCHEMA, answer)).toBeNull();
    expect(checkSpec(withoutNulls(answer))).toBeNull();
  });
});

describe('queries run on the device', () => {
  test('spending by month, net of transfers and income', () => {
    const r = runChart(spec({}), ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.table.x).toEqual(months);
    expect(r.table.labels).toEqual(['Jan 2025', 'Feb 2025', 'Mar 2025']);
    expect(r.table.series[0]!.values).toEqual([200, 210, 221]);
    expect(r.table.series[0]!.provenance).toBe('actual');
    expect(r.table.window).toEqual({ from: '2025-01', to: '2025-03' });
  });

  test('a category against its budget; budget is a monthly rate', () => {
    const r = runChart(
      spec({
        kind: 'line',
        series: [
          { label: 'Groceries', dataset: 'spending', filter: { categories: ['food.groceries'] } },
          { label: 'Budget', dataset: 'budget', filter: { categories: ['food.groceries'] } },
        ],
      }),
      ctx
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.table.series[0]!.values).toEqual([100, 110, 120]);
    // $25 a week × 52/12.
    expect(r.table.series[1]!.values).toEqual([108.33, 108.33, 108.33]);
    expect(r.table.series[1]!.provenance).toBe('budgeted');
  });

  test('by group and merchant: monthly averages, biggest first', () => {
    const g = runChart(spec({ groupBy: 'group' }), ctx);
    if (!g.ok) throw new Error(g.error);
    expect(g.table.x).toEqual(['food', 'transport']);
    expect(g.table.labels).toEqual(['Food', 'Transport']);
    expect(g.table.perMonth).toBe(true);
    expect(g.table.series[0]!.values).toEqual([150.33, 60]);
    const m = runChart(
      spec({
        groupBy: 'merchant',
        series: [{ label: 'Visits', dataset: 'spending', measure: 'count' }],
      }),
      ctx
    );
    if (!m.ok) throw new Error(m.error);
    expect(m.table.labels[0]).toBe('Bean There');
    expect(m.table.series[0]!.values[0]).toBe(2.3);
  });

  test('filters: words, the last N months, quarters, income', () => {
    const w = runChart(
      spec({
        series: [{ label: 'Coffee', dataset: 'spending', filter: { text: 'bean', lastMonths: 2 } }],
      }),
      ctx
    );
    if (!w.ok) throw new Error(w.error);
    expect(w.table.x).toEqual(['2025-02', '2025-03']);
    expect(w.table.series[0]!.values).toEqual([40, 41]);
    const q = runChart(
      spec({ groupBy: 'quarter', series: [{ label: 'Pay', dataset: 'income' }] }),
      ctx
    );
    if (!q.ok) throw new Error(q.error);
    expect(q.table.labels).toEqual(['Q1 2025']);
    expect(q.table.series[0]!.values).toEqual([9000]);
  });

  test('nothing to chart is an error in words', () => {
    const r = runChart(
      spec({
        groupBy: 'category',
        series: [{ label: 'x', dataset: 'spending', filter: { text: 'zzz' } }],
      }),
      ctx
    );
    expect(r.ok).toBe(false);
    expect(runChart(spec({}), { ...ctx, txns: [] }).ok).toBe(false);
  });

  test('a series nothing matches is left out with a note, not drawn as zero', () => {
    const r = runChart(
      spec({
        kind: 'line',
        series: [
          { label: 'Fuel', dataset: 'spending', filter: { categories: ['transport.fuel'] } },
          { label: 'Budget', dataset: 'budget', filter: { categories: ['transport.fuel'] } },
        ],
      }),
      ctx
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.table.series.map((x) => x.label)).toEqual(['Fuel']);
    expect(r.table.notes).toEqual(["Budget: there is no budget for this yet, so it isn't shown."]);
  });

  test('CSV: one column per series; text that a spreadsheet would run is defused', () => {
    const r = runChart(spec({ groupBy: 'merchant' }), ctx);
    if (!r.ok) throw new Error(r.error);
    const csv = tableCsv(r.table);
    expect(csv.split('\n')[0]).toBe(',"Spending (AUD a month, actual)"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")",60`);
  });
});

describe('charts asked for in words', () => {
  test('the words become a request', () => {
    expect(matchChart('chart my spending on groceries by month against the budget')).toEqual({
      dataset: 'spending',
      groupBy: 'month',
      topic: 'groceries',
      vsBudget: true,
    });
    expect(matchChart('graph income over the last 2 years by quarter')).toMatchObject({
      dataset: 'income',
      groupBy: 'quarter',
      months: 24,
    });
    expect(matchChart('show my spending by category')).toMatchObject({ groupBy: 'category' });
    expect(matchChart('show me the forecast')).toBeNull();
    // Something Crux can't name goes to the AI.
    expect(matchChart('can you draw how my coffee habit has changed lately?')).toBeNull();
    expect(matchChart('plot cafes by month')).toBeNull();
    expect(matchChart('plot spending on cafes by month')).toMatchObject({ topic: 'cafes' });
    expect(matchIntent('open saved charts')).toEqual({
      id: 'navigate',
      path: '/charts',
      label: 'Saved charts',
    });
  });

  test('topics resolve to categories, or to words to look for', () => {
    expect(topicCategories('cafes', categories)).toEqual(['food.cafes']);
    expect(topicCategories('Food', categories)).toEqual(['food']);
    const s = specFromRequest(
      { dataset: 'spending', groupBy: 'month', topic: 'groceries', vsBudget: true },
      categories
    );
    expect(checkSpec(s)).toBeNull();
    expect(s.kind).toBe('line');
    expect(s.series.map((x) => x.dataset)).toEqual(['spending', 'budget']);
    const words = specFromRequest(
      { dataset: 'spending', groupBy: 'category', topic: 'bean there', vsBudget: false },
      categories
    );
    expect(words.series[0]!.filter).toEqual({ text: 'bean there' });
    expect(words.caption).toMatch(/mention it/);
  });

  test('savings over time: from the latest run, a point a year, with the floor', () => {
    const capital = {
      asOf: '2026-10',
      months: [0, 12, 24, 36],
      q: {
        p5: [100, 90, 50, 0],
        p25: [100, 110, 100, 80],
        p50: [100, 120, 130, 140],
        p75: [100, 130, 160, 190],
        p95: [100, 150, 210, 280],
      },
      floor: 20,
      start: '2027-07',
    };
    const fan = {
      kind: 'fan' as const,
      title: 'Savings',
      groupBy: 'year' as const,
      series: [{ label: 'Savings', dataset: 'capital' as const }],
    };
    expect(checkSpec(fan)).toBeNull();
    const r = runChart(fan, { ...ctx, capital });
    if (!r.ok) throw new Error(r.error);
    expect(r.table.labels).toEqual(['2026', '2027 (freedom)', '2028', '2029']);
    expect(r.table.series.map((s) => s.role)).toEqual(['p5', 'p25', 'p50', 'p75', 'p95']);
    expect(r.table.series.every((s) => s.provenance === 'forecast')).toBe(true);
    expect(r.table.floor).toBe(20);
    const line = runChart({ ...fan, kind: 'line' }, { ...ctx, capital });
    if (!line.ok) throw new Error(line.error);
    expect(line.table.series.map((s) => s.role)).toEqual(['p5', 'p50', 'p95']);
    // No run yet: an error that says how to get one.
    const none = runChart(fan, ctx);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/run my plan/i);
  });

  test('savings over time is a chart on its own, by year; a fan is only for it', () => {
    const cap = { label: 'Savings', dataset: 'capital' as const };
    expect(
      checkSpec(
        spec({ kind: 'fan', groupBy: 'year', series: [cap, { label: 's', dataset: 'spending' }] })
      )
    ).toMatch(/on its own/);
    expect(checkSpec(spec({ kind: 'fan', groupBy: 'month', series: [cap] }))).toMatch(/by year/);
    expect(checkSpec(spec({ kind: 'bar', groupBy: 'year', series: [cap] }))).toMatch(
      /fan, a line or a table/
    );
    expect(checkSpec(spec({ kind: 'fan', groupBy: 'year' }))).toMatch(/only savings/);
  });

  test('"chart my savings over time" asks for the fan', () => {
    expect(matchChart('chart my savings over time')).toEqual({
      dataset: 'capital',
      groupBy: 'year',
      vsBudget: false,
    });
    expect(matchChart('show my savings balance in the freedom scenario')).toMatchObject({
      dataset: 'capital',
    });
    expect(
      specFromRequest({ dataset: 'capital', groupBy: 'year', vsBudget: false }, categories).kind
    ).toBe('fan');
  });
});
