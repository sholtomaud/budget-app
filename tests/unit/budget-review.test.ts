/** The budget review: deadband, gain, hysteresis, essentials only up (ADR 0038). Made-up data. */
import { describe, expect, test } from 'vitest';
import { DEFAULT_PERIODS } from '../../src/budget/periods.ts';
import { DEFAULT_TIERS, type BudgetLine } from '../../src/budget/model.ts';
import {
  donorFor,
  GAIN,
  monthlyBudget,
  reviewBudget,
  scaleCategory,
  type ReviewInput,
  type ReviewLogEntry,
} from '../../src/budget/review.ts';
import type { Txn } from '../../src/domain/types.ts';
import { addMonths } from '../../src/lib/dates.ts';

let n = 0;
const txn = (date: string, dollars: number, categoryId: string): Txn => ({
  id: `t${++n}`,
  accountId: 'SYN-A',
  idSynthetic: false,
  status: 'POSTED',
  cdrType: 'PAYMENT',
  date,
  amount: BigInt(Math.round(-dollars * 100)),
  currency: 'AUD',
  description: categoryId,
  importIds: ['i1'],
  provenance: 'illustrative',
  classification: { kind: 'opex', categoryId, confidence: 1, by: 'rule' },
});

/** Monthly spending per category for `months` months from 2025-01; the month's end closes it. */
function history(months: number, perMonth: (cat: string, i: number) => number, cats: string[]) {
  const out: Txn[] = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths('2025-01-01', i).slice(0, 7);
    for (const c of cats) {
      const v = perMonth(c, i);
      if (v) out.push(txn(`${m}-10`, v, c));
    }
    out.push(txn(`${m}-28`, 0.01, 'misc.tiny'));
  }
  // Data runs to the last month's end, so it is complete.
  out.push(txn(`${addMonths('2025-01-01', months - 1).slice(0, 7)}-31`, 0.01, 'misc.tiny'));
  return out;
}

const line = (id: string, categoryId: string, monthly: number, secure = 1): BudgetLine => ({
  id,
  categoryId,
  item: id,
  cost: BigInt(monthly * 100),
  ccy: 'AUD',
  period: 'm',
  tierMultiplier: { secure, independent: 1, luxury: 1 },
});

const base = (lines: BudgetLine[], txns: Txn[], log: ReviewLogEntry[] = []): ReviewInput => ({
  lines,
  txns,
  periods: DEFAULT_PERIODS,
  tier: 'independent',
  tiers: DEFAULT_TIERS,
  log,
});

// A little noise so the band has width: ±3 % around the level.
const noisy = (level: number, i: number) => level * (1 + 0.03 * Math.sin(i * 1.7));

describe('the deadband: noise moves nothing', () => {
  test('a budget inside its band is steady', () => {
    const r = reviewBudget(
      base(
        [line('rent', 'housing.rent', 2000)],
        history(12, (_, i) => noisy(2000, i), ['housing.rent'])
      )
    );
    expect(r.findings).toEqual([]);
    expect(r.steady).toContain('housing.rent');
  });

  test('a category with under six months of spending is left alone, said as new', () => {
    const r = reviewBudget(
      base(
        [line('gym', 'health.gym', 40, 0)],
        history(4, () => 90, ['health.gym'])
      )
    );
    expect(r.skipped).toEqual([{ categoryId: 'health.gym', why: 'new' }]);
  });

  test("the forecast model's range is used when there is one", () => {
    const r = reviewBudget({
      ...base(
        [line('rent', 'housing.rent', 2000)],
        history(12, (_, i) => noisy(2300, i), ['housing.rent'])
      ),
      modelBands: { 'housing.rent': { lo: 210000, hi: 260000 } },
    });
    expect(r.findings[0]).toMatchObject({ kind: 'raise', band: { source: 'model' } });
  });
});

describe('the gain and the direction', () => {
  const rentUp = history(12, (_, i) => noisy(i < 6 ? 2000 : 2400, i), ['housing.rent']);

  test('an essential that costs more: raised half way, rounded to $10', () => {
    const r = reviewBudget(base([line('rent', 'housing.rent', 2000)], rentUp));
    const f = r.findings[0]!;
    expect(f).toMatchObject({ categoryId: 'housing.rent', kind: 'raise', essential: true });
    const expected = Math.round((200000 + GAIN * (f.runRate - 200000)) / 1000) * 1000;
    expect(f.proposed).toBe(expected);
    expect(f.proposed).toBeGreaterThan(200000);
    expect(f.proposed).toBeLessThan(f.runRate);
  });

  test('an essential that costs less is never proposed down; six months well under is said', () => {
    const r = reviewBudget(
      base(
        [line('power', 'utilities.electricity', 300)],
        history(12, (_, i) => noisy(150, i), ['utilities.electricity'])
      )
    );
    expect(r.findings).toEqual([
      expect.objectContaining({ kind: 'under', proposed: 30000, essential: true }),
    ]);
  });

  test('discretionary: over its budget is a choice; under it, lowered', () => {
    const r = reviewBudget(
      base(
        [line('dining', 'food.dining', 200, 0), line('clothes', 'shopping.clothing', 300, 0)],
        history(12, (c, i) => noisy(c === 'food.dining' ? 320 : 120, i), [
          'food.dining',
          'shopping.clothing',
        ])
      )
    );
    const by = Object.fromEntries(r.findings.map((f) => [f.categoryId, f]));
    expect(by['food.dining']).toMatchObject({ kind: 'choice', essential: false });
    expect(by['shopping.clothing']).toMatchObject({ kind: 'lower' });
    expect(by['shopping.clothing']!.proposed).toBeLessThan(30000);
    // Clothing has room to cover dining's raise.
    expect(donorFor(by['food.dining']!, r)).toEqual({
      categoryId: 'shopping.clothing',
      room: expect.any(Number),
    });
  });
});

describe('hysteresis and convergence', () => {
  test('a category changed in the last two reviews is held', () => {
    const txns = history(12, (_, i) => noisy(i < 6 ? 2000 : 2400, i), ['housing.rent']);
    const log = [{ categoryId: 'housing.rent', month: '2025-11', from: 200000, to: 220000 }];
    const r = reviewBudget(base([line('rent', 'housing.rent', 2000)], txns, log));
    expect(r.skipped).toEqual([{ categoryId: 'housing.rent', why: 'recent' }]);
  });

  test('rent steps up: applying every proposal settles within its band, without overshoot', () => {
    let lines = [line('rent', 'housing.rent', 2000)];
    const log: ReviewLogEntry[] = [];
    const level = (i: number) => (i < 6 ? 2000 : 2400);
    const budgets: number[] = [];
    for (let months = 8; months <= 20; months++) {
      const r = reviewBudget(
        base(
          lines,
          history(months, (_, i) => noisy(level(i), i), ['housing.rent']),
          log
        )
      );
      const f = r.findings.find((x) => x.kind === 'raise');
      if (f) {
        lines = scaleCategory(lines, 'housing.rent', f.budget, f.proposed).after;
        log.push({ categoryId: 'housing.rent', month: r.month!, from: f.budget, to: f.proposed });
      }
      budgets.push(monthlyBudget(lines, 'independent', DEFAULT_PERIODS).get('housing.rent')!);
    }
    const last = budgets.at(-1)!;
    // Converged near the new rent (inside the ±3 % noise), never above it.
    expect(Math.abs(last - 240000)).toBeLessThan(240000 * 0.04);
    expect(Math.max(...budgets)).toBeLessThanOrEqual(240000 * 1.03);
    // Each step moved up, no back-and-forth.
    for (let i = 1; i < budgets.length; i++)
      expect(budgets[i]!).toBeGreaterThanOrEqual(budgets[i - 1]!);
    expect(log.length).toBeLessThanOrEqual(4);
  });
});

describe('a change applies to every line of the category, keeping shares', () => {
  test('two lines scaled together, to the dollar; other categories untouched', () => {
    const lines = [
      line('a', 'food.groceries', 300),
      line('b', 'food.groceries', 100),
      line('c', 'food.dining', 50),
    ];
    const { before, after } = scaleCategory(lines, 'food.groceries', 40000, 50000);
    expect(before.map((l) => l.id)).toEqual(['a', 'b']);
    expect(after.map((l) => Number(l.cost))).toEqual([37500, 12500]);
    expect(after[0]!.tierMultiplier).toEqual(lines[0]!.tierMultiplier);
  });
});

describe('asked for in words', () => {
  test('"review my budget" and the like are the review, on the device', async () => {
    const { matchIntent } = await import('../../src/assistant/intents.ts');
    for (const q of [
      'Review my budget',
      'is my budget still right?',
      'adjust the budget',
      'budget review',
    ])
      expect(matchIntent(q), q).toEqual({ id: 'review' });
  });
});
