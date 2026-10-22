/** Budget lines that end, like a mortgage paid off (FR-BUD-005). All figures are made up. */
import { describe, expect, test } from 'vitest';
import { matchIntent } from '../../src/assistant/intents.ts';
import { editLine, mergeReimport, rowOf, withSheet } from '../../src/budget/edit.ts';
import { DEFAULT_TIERS, endedBy, weeklyRate, type BudgetLine } from '../../src/budget/model.ts';
import { DEFAULT_PERIODS, perWeek } from '../../src/budget/periods.ts';
import { emptyBudget } from '../../src/budget/state.ts';
import { preview } from '../../src/budget/workbook.ts';
import {
  applySpendingLevers,
  defaultSetup,
  scenarioFrom,
  spendingFrom,
} from '../../src/sim/inputs.ts';
import { deterministicFreedom, needBreakdown } from '../../src/sim/metrics.ts';

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: 'l',
  categoryId: 'food.groceries',
  item: 'Groceries',
  cost: 800_00n,
  ccy: 'AUD',
  period: 'm',
  tierMultiplier: { secure: 1, independent: 1, luxury: 1 },
  ...over,
});
const mortgage = (endDate?: string) =>
  line({
    id: 'm',
    categoryId: 'housing.mortgage',
    item: 'Mortgage',
    cost: 3_000_00n,
    ...(endDate ? { endDate } : {}),
  });
const per = (c: string) => perWeek(c, DEFAULT_PERIODS);
const household = (lines: BudgetLine[]) => ({
  accounts: [],
  balances: [],
  txns: [],
  assets: [],
  budget: { ...emptyBudget(), lines, tiers: DEFAULT_TIERS },
});

describe('a line that ends', () => {
  test('is paid through its last month, then counts as nothing', () => {
    const m = mortgage('2038-03');
    expect(endedBy(m, '2038-03')).toBe(false);
    expect(endedBy(m, '2038-04-01')).toBe(true);
    expect(weeklyRate(m, 'secure', per, '2038-03')).toBeGreaterThan(0);
    expect(weeklyRate(m, 'secure', per, '2038-04')).toBe(0);
    // No month given: the rate as before.
    expect(weeklyRate(m, 'secure', per)).toBeGreaterThan(0);
  });

  test('its end is a cell: a month, or empty to run on; anything else is refused', () => {
    const opts = { tier: 'secure', periods: DEFAULT_PERIODS };
    const set = editLine(mortgage(), 'endDate', '2038-03', opts);
    expect(set.ok && set.line.endDate).toBe('2038-03');
    const cleared = editLine(mortgage('2038-03'), 'endDate', '', opts);
    expect(cleared.ok && 'endDate' in cleared.line).toBe(false);
    expect(editLine(mortgage(), 'endDate', 'March', opts).ok).toBe(false);
    expect(editLine(mortgage(), 'endDate', '2038-13', opts).ok).toBe(false);
  });

  test('an end set here survives re-importing a sheet that has none', () => {
    const imported = { ...mortgage(), source: { file: 'opex.csv', row: 4 } };
    const edited = withSheet(imported, { ...imported, endDate: '2038-03' });
    expect(edited.sheet).toEqual(rowOf(imported));
    const m = mergeReimport([edited], [], 'opex.csv', [imported]);
    expect(m.lines[0]!.endDate).toBe('2038-03');
  });

  test('a sheet column "End date" sets it; a year alone means paid through December', () => {
    const csv = [
      'Category,Item,Cost,Unit,End date,Fin. Secure,Fin. Indepnt,Fin. Luxury',
      'HOUSING,Mortgage,$700,w,2038-03-31,1,1,1',
      'HOUSING,Car loan,$100,w,2029,1,1,1',
      'FOOD,Groceries,$100,w,,1,1,1',
    ].join('\n');
    const p = preview('budget.csv', `# x-synthetic: made up\n${csv}`);
    expect(p.lines.map((l) => [l.item, l.endDate])).toEqual([
      ['Mortgage', '2038-03'],
      ['Car loan', '2029-12'],
      ['Groceries', undefined],
    ]);
  });
});

describe('plans with a line that ends', () => {
  const plan = (lines: BudgetLine[], start: string, lever = 1) => {
    const d = household(lines);
    const setup = defaultSetup(d, '2026-10-01');
    setup.goal = { ...setup.goal, tier: 'secure', start };
    const s = { ...scenarioFrom(setup, '2026-10', 0.03), taxTable: null };
    const sp = applySpendingLevers(spendingFrom(d, 'secure'), {
      tierSpend: lever,
      currentSpend: 1,
    });
    return { s, sp };
  };

  test('ending later: counted now, and the simulation is told when it stops', () => {
    const { sp } = plan([line(), mortgage('2038-03')], '2030-01-01');
    expect(sp.tier.housing).toBeCloseTo(3_000, 6);
    expect(sp.ends).toEqual([
      { item: 'Mortgage', group: 'housing', from: '2038-04', monthly: 3_000 },
    ]);
    // The lever scales it like the rest of the tier.
    expect(plan([mortgage('2038-03')], '2030-01-01', 0.5).sp.ends![0]!.monthly).toBeCloseTo(
      1_500,
      6
    );
  });

  test('ended already: not in the plan at all', () => {
    const { sp } = plan([line(), mortgage('2020-06')], '2030-01-01');
    expect(sp.tier.housing ?? 0).toBe(0);
    expect(sp.ends).toBeUndefined();
  });

  test('the freedom number counts what is still paid when freedom starts, and says what ends later', () => {
    const before = plan([line(), mortgage('2029-12')], '2030-01-01');
    expect(deterministicFreedom(before.s, before.sp).annualNeed).toBeCloseTo(12 * 800, 6);
    const after = plan([line(), mortgage('2038-03')], '2030-01-01');
    expect(deterministicFreedom(after.s, after.sp).annualNeed).toBeCloseTo(12 * 3_800, 6);
    const n = needBreakdown(after.s, after.sp, 1);
    expect(n.endsLater).toEqual([{ item: 'Mortgage', from: '2038-04', monthly: 3_000 }]);
    expect(needBreakdown(before.s, before.sp, 1).byGroup.map((g) => g.group)).toEqual(['food']);
  });

  test('in words: "until March 2038", "for 12 more years"', () => {
    expect(matchIntent('Our mortgage is $3,035 a month until March 2038')).toMatchObject({
      id: 'budget-line',
      item: 'mortgage',
      amount: 3035,
      until: '2038-03',
    });
    expect(matchIntent('I pay $400 a month for the car loan for 3 more years')).toMatchObject({
      item: 'car loan',
      forYears: 3,
    });
    expect(matchIntent('I pay $45 a month for the gym')).not.toHaveProperty('until');
  });
});
