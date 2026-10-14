import { describe, expect, test } from 'vitest';
import { actualVsBudget, windowFor } from '../../src/budget/actuals.ts';
import { annualisedCapexPerWeek, capexSummary, inTier } from '../../src/budget/capex.ts';
import {
  expectedRemaining,
  remainingQuantile,
  replacementSummary,
} from '../../src/budget/lifetime.ts';
import { DEFAULT_TIERS, type BudgetLine } from '../../src/budget/model.ts';
import { perWeek } from '../../src/budget/periods.ts';
import {
  detect,
  isBudgetSheet,
  parseDate,
  parseMoney,
  preview,
} from '../../src/budget/workbook.ts';
import { parseCsv } from '../../src/lib/csv.ts';
import { Rng, weibullScale } from '../../src/lib/prng.ts';
import type { Asset, Txn } from '../../src/domain/types.ts';
import { synth } from '../helpers/synth.ts';

const file = async (persona: string, path: string) =>
  (await synth(persona)).files.find((f) => f.path === path)!.content;

describe('periods (FR-ING-012)', () => {
  test('codes normalise to per-week rates', () => {
    expect(perWeek('w')).toBe(1);
    expect(perWeek('M')).toBeCloseTo(12 / 52, 12);
    expect(perWeek('5y')).toBeCloseTo(1 / 260, 12);
    expect(perWeek('4v')).toBeCloseTo(4 / 52, 12);
    expect(perWeek('fortnightly-ish')).toBeUndefined();
  });
});

describe('workbook CSV import (FR-ING-010…014)', () => {
  test.each(['default', 'frugal-renter', 'high-capex-crypto'])(
    '%s OPEX sheet: totals match the file within 0.5 %%, rows keep their source',
    async (persona) => {
      const text = await file(persona, 'workbook/opex-budget.csv');
      const p = preview('opex-budget.csv', text);
      expect(p.mapping.type).toBe('opex');
      expect(p.lines.length).toBeGreaterThan(3);
      for (const t of DEFAULT_TIERS) expect(p.totals[t.id], t.id).toMatchObject({ matches: true });
      // FR-ING-013: the source row is the spreadsheet row (1-based, comment line included).
      const rows = parseCsv(text);
      for (const l of p.lines) expect(rows[l.source!.row - 1]![1]).toBe(l.item);
      expect(p.lines.every((l) => l.categoryId.includes('.'))).toBe(true);
      expect(p.issues).toEqual([]);
      expect(isBudgetSheet(text)).toBe(true);
      expect(isBudgetSheet(await file(persona, 'workbook/capex-register.csv'))).toBe(true);
    }
  );

  test('CAPEX sheet: assets, owned vs planned, assumed lives flagged (FR-CAP-005)', async () => {
    const p = preview(
      'capex-register.csv',
      await file('high-capex-crypto', 'workbook/capex-register.csv'),
      {
        defaultLife: () => ({ meanYears: 7, shape: 2 }),
      }
    );
    expect(p.mapping.type).toBe('capex');
    const laptop = p.assets.find((a) => a.name === 'Laptop')!;
    expect(laptop).toMatchObject({
      status: 'owned',
      categoryId: 'capex.computing',
      lifeAssumed: false,
      life: { meanYears: 3 },
    });
    const holiday = p.assets.find((a) => a.name.startsWith('Holiday'))!;
    expect(holiday.categoryId).toBe('capex.travel');
    // One asset per item, latest purchase kept.
    expect(new Set(p.assets.map((a) => a.name)).size).toBe(p.assets.length);
  });

  test('error literals are reported and skipped; bad amounts and periods too (FR-ING-011)', () => {
    const csv = [
      'Category,Item,Cost,Unit,Fin. Secure,Fin. Indepnt,Fin. Luxury',
      'Housing,,,,,,',
      ',Rent,620,w,1,1.25,#REF!',
      ',Broken,#DIV/0!,w,1,1,1',
      ',Typo,12x,m,1,1,1',
      ',Odd,10,fortnightly-ish,1,1,1',
      'TOTAL per week,,,,620.00,775.00,620.00',
    ].join('\n');
    const p = preview('b.csv', csv);
    expect(p.lines.map((l) => l.item)).toEqual(['Rent']);
    expect(p.lines[0]!.tierMultiplier).toEqual({ secure: 1, independent: 1.25, luxury: 1 });
    expect(p.issues.map((i) => [i.row, i.message.slice(0, 18)])).toEqual([
      [3, 'Cell holds #REF!; '],
      [4, 'Cell holds #DIV/0!'],
      [5, '"12x" is not an am'],
      [6, 'Unknown period "fo'],
    ]);
    expect(p.totals.secure).toMatchObject({ computed: 62000, file: 62000, matches: true });
  });

  test('detects every preset from its headers', () => {
    expect(
      detect(parseCsv('Item,Link,Config,Toggle,Price,Forecast Spend,Date Paid,Actual Spend\n')).type
    ).toBe('wishlist');
    expect(detect(parseCsv('Item,Date,Cost\n')).type).toBe('renewals');
    expect(detect(parseCsv('# x-synthetic\nField,Value\n')).type).toBe('goal');
  });

  test('money and dates in spreadsheet formats', () => {
    expect(parseMoney('$1,234.50')).toBe(123450n);
    expect(parseMoney('(12.00)')).toBe(-1200n);
    expect(parseMoney('12.345')).toBe(1235n);
    expect(parseMoney('abc')).toBeUndefined();
    expect(parseDate('14/03/2025')).toBe('2025-03-14');
    expect(parseDate('2025-3-4')).toBe('2025-03-04');
    expect(parseDate('2021')).toBe('2021-01-01');
  });
});

describe('replacement timing (FR-CAP-001)', () => {
  test('conditional Weibull quantiles agree with Monte-Carlo', () => {
    const k = 3;
    const scale = weibullScale(5, k);
    const rng = new Rng(11);
    const draws = Array.from({ length: 20000 }, () => rng.weibullGiven(k, scale, 4) - 4).sort(
      (a, b) => a - b
    );
    for (const q of [0.1, 0.5, 0.9])
      expect(remainingQuantile(q, k, scale, 4)).toBeCloseTo(
        draws[Math.floor(q * draws.length)]!,
        1
      );
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    expect(expectedRemaining(k, scale, 4)).toBeCloseTo(mean, 1);
  });

  test('a new item has its full mean life remaining', () => {
    const r = replacementSummary(5, 3, 0);
    expect(r.expectedRemainingYears).toBeCloseTo(5, 3);
    expect(r.p10).toBeLessThan(r.p50);
    expect(r.p50).toBeLessThan(r.p90);
  });
});

const asset = (o: Partial<Asset>): Asset => ({
  id: o.name ?? 'a',
  name: 'Laptop',
  categoryId: 'capex.computing',
  purchasedAt: '2024-01-01',
  cost: { minor: 260000n, ccy: 'AUD' },
  life: { meanYears: 4, shape: 3 },
  lifeAssumed: false,
  replace: true,
  status: 'owned',
  linkedTxnIds: [],
  provenance: 'illustrative',
  ...o,
});

describe('sinking fund and annualised CAPEX (FR-CAP-002/003/004)', () => {
  test('annualised CAPEX per tier counts assets at or below the tier', () => {
    const assets = [
      asset({ name: 'Laptop' }),
      asset({
        name: 'Watch',
        cost: { minor: 520000n, ccy: 'AUD' },
        life: { meanYears: 10 },
        tier: 'luxury',
      }),
    ];
    expect(annualisedCapexPerWeek(assets, 'secure', DEFAULT_TIERS)).toBeCloseTo(260000 / 4 / 52, 6);
    expect(annualisedCapexPerWeek(assets, 'luxury', DEFAULT_TIERS)).toBeCloseTo(
      260000 / 4 / 52 + 520000 / 10 / 52,
      6
    );
    expect(inTier(asset({ decision: { action: 'drop' } }), 'luxury', DEFAULT_TIERS)).toBe(false);
  });

  test('over a long horizon the sinking fund converges to cost / life', () => {
    const s = capexSummary([asset({})], '2024-01-01', { cpi: 0.03, horizonYears: 40 });
    expect(s.sinkingFundPerWeek / (260000 / 4 / 52)).toBeCloseTo(1, 1);
    expect(s.assets[0]!.replacement!.p50).toBeGreaterThan(0);
    expect(s.assets[0]!.costNominal).toBeGreaterThan(s.assets[0]!.costReal);
  });

  test('is deterministic, and wish-list decisions count once or not at all', () => {
    const a = capexSummary([asset({})], '2025-06-01', { cpi: 0.03, horizonYears: 10 });
    const b = capexSummary([asset({})], '2025-06-01', { cpi: 0.03, horizonYears: 10 });
    expect(a.sinkingFundPerWeek).toBe(b.sinkingFundPerWeek);
    const wish = asset({
      status: 'wish',
      purchasedAt: undefined,
      decision: { action: 'buy', by: '2027-01-01' },
    });
    expect(
      capexSummary([wish], '2025-06-01', { cpi: 0, horizonYears: 10 }).expectedByYear[1]
    ).toBeCloseTo(260000, 0);
    expect(
      capexSummary([{ ...wish, decision: { action: 'defer' } }], '2025-06-01', {
        cpi: 0,
        horizonYears: 10,
      }).sinkingFundPerWeek
    ).toBe(0);
  });
});

describe('actual vs budget (FR-BUD-001)', () => {
  const tx = (
    date: string,
    amount: bigint,
    categoryId: string,
    kind: 'opex' | 'refund' | 'transfer' | 'capex' = 'opex',
    extra: Partial<Txn> = {}
  ): Txn => ({
    id: `${date}${amount}${categoryId}`,
    accountId: 'SYN-A',
    idSynthetic: false,
    status: 'POSTED',
    cdrType: 'PAYMENT',
    date,
    amount,
    currency: 'AUD',
    description: categoryId,
    importIds: [],
    provenance: 'illustrative',
    classification: { kind, categoryId, confidence: 1, by: 'user' },
    ...extra,
  });
  const lines: BudgetLine[] = [
    {
      id: 'l1',
      categoryId: 'food.groceries',
      item: 'Groceries',
      cost: 14000n,
      ccy: 'AUD',
      period: 'w',
      tierMultiplier: { secure: 1, independent: 1.5, luxury: 2 },
    },
    {
      id: 'l2',
      categoryId: 'food.cafe',
      item: 'Cafe',
      cost: 2000n,
      ccy: 'AUD',
      period: 'w',
      tierMultiplier: { secure: 0, independent: 1, luxury: 2 },
    },
  ];
  const txns = [
    tx('2025-03-03', -50000n, 'food.groceries'),
    tx('2025-03-20', -15000n, 'food.groceries'),
    tx('2025-03-21', 5000n, 'food.groceries', 'refund'),
    tx('2025-03-05', -900n, 'food.cafe'),
    tx('2025-03-06', -100000n, 'transfer.internal', 'transfer', { transferPairId: 'p' }),
    tx('2025-03-07', -300000n, 'capex.computing', 'capex'),
    tx('2025-02-10', -60000n, 'food.groceries'),
    tx('2025-03-08', -7000n, 'food.groceries', 'opex', { supersededBy: 'x', status: 'PENDING' }),
  ];

  test('budget, actual net of refunds, variance; transfers, capex and superseded pendings excluded', () => {
    const r = actualVsBudget(txns, lines, { tier: 'secure', span: 'month', end: '2025-03-31' });
    expect(r.window).toMatchObject({ from: '2025-03-01', to: '2025-03-31' });
    const g = r.rows.find((x) => x.categoryId === 'food.groceries')!;
    expect(g.actual).toBe(60000n);
    expect(g.budget).toBeCloseTo(14000 * (52 / 12), 6);
    expect(g.variance).toBeCloseTo(g.budget - 60000, 6);
    expect(g.runRate.m3).toBeCloseTo((120000 / 3) * 1, 6);
    // Secure tier excludes the cafe line (multiplier 0) but still reports the actual.
    const c = r.rows.find((x) => x.categoryId === 'food.cafe')!;
    expect(c.budget).toBe(0);
    expect(c.variancePct).toBeNull();
    expect(r.rows.some((x) => x.categoryId === 'transfer.internal')).toBe(false);
    expect(r.capexActual).toBe(300000n);
  });

  test('tiers scale the budget; week and year windows', () => {
    const lux = actualVsBudget(txns, lines, { tier: 'luxury', span: 'week', end: '2025-03-07' });
    expect(lux.rows.find((x) => x.categoryId === 'food.cafe')!.budget).toBe(4000);
    expect(windowFor('year', '2025-03-15')).toMatchObject({ from: '2024-04-01', to: '2025-03-31' });
  });
});
