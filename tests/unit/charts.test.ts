/** Charts in the chat: specs, their checks, the queries and the CSV (FR-VIZ-001…006, ADR 0028). */
import { readFileSync } from 'node:fs';
import { ADVISOR_SYSTEM, ADVISOR_TOOLS } from '../../src/advisor/tools.ts';
import { describe, expect, test } from 'vitest';
import { matchChart, matchIntent } from '../../src/assistant/intents.ts';
import { DEFAULT_TIERS, type BudgetLine } from '../../src/budget/model.ts';
import { DEFAULT_PERIODS } from '../../src/budget/periods.ts';
import type { Category } from '../../src/classify/categories.ts';
import type { Asset, ClassificationKind, Txn } from '../../src/domain/types.ts';
import { validate } from '../../src/lib/jsonschema.ts';
import { plannedPurchases, runChart, tableCsv, type QueryContext } from '../../src/viz/query.ts';
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
            nextMonths: null,
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
});

function asset(name: string, dollars: number, a: Partial<Asset> = {}): Asset {
  return {
    id: `a-${name}`,
    name,
    categoryId: 'transport.car',
    cost: { minor: BigInt(dollars * 100), ccy: 'AUD' },
    life: { meanYears: 8 },
    lifeAssumed: false,
    replace: true,
    status: 'owned',
    linkedTxnIds: [],
    provenance: 'illustrative',
    ...a,
  };
}

const assets: Asset[] = [
  asset('Car', 20000, { purchasedAt: '2022-10-01' }),
  asset('Laptop', 2000, {
    categoryId: 'home.tech',
    life: { meanYears: 3 },
    purchasedAt: '2025-01-01',
  }),
  asset('Boat', 30000, { status: 'wish', decision: { action: 'buy', by: '2028-03-15' } }),
  asset('Couch', 1500, { categoryId: 'home.furniture', status: 'planned' }),
  asset('Jet ski', 9000, { status: 'wish', decision: { action: 'defer' } }),
  asset('Piano', 8000, { status: 'wish', decision: { action: 'drop' } }),
  asset('Old bike', 500, { status: 'retired', purchasedAt: '2015-01-01' }),
  asset('Yacht', 900000, { status: 'wish', tier: 'luxury' }),
  asset('Kettle', 50, { replace: false, purchasedAt: '2024-01-01' }),
];
const future: QueryContext = {
  ...ctx,
  assets,
  tiers: DEFAULT_TIERS,
  today: '2026-10-13',
  horizonYears: 10,
};

describe('big purchases: when they fall due (FR-CAP-001, FR-CAP-004)', () => {
  test('owned items recur every life from their median date; wish-list items at their date', () => {
    const p = plannedPurchases(future, 120);
    const names = new Set(p.map((x) => x.item));
    expect([...names].sort()).toEqual(['Boat', 'Car', 'Couch', 'Laptop']);
    expect(p.every((x) => x.month >= '2026-10' && x.month < '2036-10')).toBe(true);
    expect(p.map((x) => x.month)).toEqual(p.map((x) => x.month).sort());
    expect(p.find((x) => x.item === 'Boat')).toMatchObject({ month: '2028-03', value: 30000 });
    // No date: this month.
    expect(p.find((x) => x.item === 'Couch')!.month).toBe('2026-10');
    const laptops = p.filter((x) => x.item === 'Laptop').map((x) => x.month);
    expect(laptops.length).toBeGreaterThanOrEqual(3);
    const gap = (a: string, b: string) =>
      (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
      Number(b.slice(5)) -
      Number(a.slice(5));
    for (let i = 1; i < laptops.length; i++)
      expect(gap(laptops[i - 1]!, laptops[i]!)).toBeGreaterThanOrEqual(35);
    // A higher tier counts its items too.
    expect(
      plannedPurchases({ ...future, tier: 'luxury' }, 120).some((x) => x.item === 'Yacht')
    ).toBe(true);
  });

  test('the "when can I make my big purchases" chart: by year, provenance forecast, totals', () => {
    const s = spec({
      groupBy: 'year',
      series: [{ label: 'Big purchases', dataset: 'big-purchases' }],
    });
    expect(checkSpec(s)).toBeNull();
    const r = runChart(s, future);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.x[0]).toBe('2026');
    expect(r.table.x.at(-1)).toBe('2036');
    const bp = r.table.series[0]!;
    expect(bp.provenance).toBe('forecast');
    expect(bp.values[r.table.x.indexOf('2028')]).toBeGreaterThanOrEqual(30000);
    const total = plannedPurchases(future, 120).reduce((a, x) => a + x.value, 0);
    expect(bp.values.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 2);
    expect(bp.purchases!.map((x) => x.item)).toContain('Boat');
    expect(r.table.perMonth).toBe(false);
  });

  test('by item, filtered, and next N months; no transactions needed', () => {
    const r = runChart(
      spec({
        groupBy: 'item',
        series: [
          {
            label: 'Home',
            dataset: 'big-purchases',
            filter: { categories: ['home'], nextMonths: 24 },
          },
        ],
      }),
      { ...future, txns: [] }
    );
    expect(r.ok && r.table.labels).toEqual(['Laptop', 'Couch']);
    expect(r.ok && r.table.series[0]!.values).toEqual([2000, 1500]);
  });

  test('past spending and future purchases share one timeline', () => {
    const r = runChart(
      spec({
        groupBy: 'year',
        series: [
          { label: 'Spending', dataset: 'spending' },
          { label: 'Big purchases', dataset: 'big-purchases', filter: { to: '2029-12' } },
        ],
      }),
      future
    );
    expect(r.ok && r.table.x).toEqual(['2025', '2026', '2027', '2028', '2029']);
    expect(r.ok && r.table.series.map((x) => x.provenance)).toEqual(['actual', 'forecast']);
  });

  test('an empty register is a note, not a flat zero', () => {
    const r = runChart(spec({ series: [{ label: 'BP', dataset: 'big-purchases' }] }), {
      ...future,
      assets: [],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Big purchases screen/);
  });

  test('specs that mix the past and the future wrongly are refused in words', () => {
    const bp = { label: 'BP', dataset: 'big-purchases' as const };
    expect(checkSpec(spec({ groupBy: 'merchant', series: [bp] }))).toMatch(/no merchant/);
    expect(checkSpec(spec({ series: [{ ...bp, filter: { lastMonths: 6 } }] }))).toMatch(
      /nextMonths/
    );
    expect(
      checkSpec(spec({ series: [{ label: 'S', dataset: 'spending', filter: { nextMonths: 6 } }] }))
    ).toMatch(/past data/);
    expect(
      checkSpec(spec({ groupBy: 'category', series: [bp, { label: 'S', dataset: 'spending' }] }))
    ).toMatch(/time axis/);
    expect(
      checkSpec(spec({ groupBy: 'item', series: [{ label: 'S', dataset: 'spending' }] }))
    ).toMatch(/merchant instead/);
    expect(
      checkSpec(spec({ groupBy: 'item', series: [{ label: 'B', dataset: 'budget' }] }))
    ).toBeNull();
  });

  test('asked in words, on the device', () => {
    const r = matchChart(
      'can you generate a chart which shows when i can make my big purchases into the future.'
    );
    expect(r).toEqual({ dataset: 'big-purchases', groupBy: 'year', vsBudget: false });
    expect(matchChart('chart my big purchases by month over the next 5 years')).toMatchObject({
      groupBy: 'month',
      months: 60,
    });
    const s = specFromRequest(r!, categories);
    expect(checkSpec(s)).toBeNull();
    expect(s.series[0]!.dataset).toBe('big-purchases');
  });

  test('the AI is told about big purchases and to try a chart before declining', () => {
    const tool = ADVISOR_TOOLS.find((t) => t.name === 'make_chart')!;
    expect(tool.description).toContain('- big-purchases:');
    expect(ADVISOR_SYSTEM).toMatch(/always try make_chart before saying a chart can't be drawn/);
  });
});
