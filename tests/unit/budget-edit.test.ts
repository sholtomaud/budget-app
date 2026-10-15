/** Editing budget lines in place (FR-BUD-003, ADR 0042). */
import { describe, expect, test } from 'vitest';
import {
  editLine,
  linesIn,
  mergeReimport,
  newLine,
  rowOf,
  withSheet,
} from '../../src/budget/edit.ts';
import { DEFAULT_TIERS, type BudgetLine } from '../../src/budget/model.ts';
import { DEFAULT_PERIODS } from '../../src/budget/periods.ts';

const line: BudgetLine = {
  id: 'l1',
  categoryId: 'food.groceries',
  item: 'Groceries',
  cost: 12000n,
  ccy: 'AUD',
  period: 'w',
  tierMultiplier: { secure: 1, independent: 1.2 },
};
const opts = { tier: 'secure', periods: DEFAULT_PERIODS };

describe('a cell changes one thing on a line', () => {
  test('amounts are read as money, in cents', () => {
    const r = editLine(line, 'cost', '$1,234.5', opts);
    expect(r).toEqual({ ok: true, line: { ...line, cost: 123450n } });
  });

  test('a bad amount, a negative one or an empty name is refused, with a reason', () => {
    expect(editLine(line, 'cost', 'lots', opts)).toMatchObject({ ok: false });
    expect(editLine(line, 'cost', '-5', opts)).toMatchObject({ ok: false, error: /below zero/ });
    expect(editLine(line, 'item', '   ', opts)).toMatchObject({ ok: false });
  });

  test('periods come from the period table, or every N years', () => {
    expect(editLine(line, 'period', 'm', opts)).toMatchObject({ ok: true, line: { period: 'm' } });
    expect(editLine(line, 'period', '5y', opts)).toMatchObject({ ok: true });
    expect(editLine(line, 'period', 'sometimes', opts)).toMatchObject({ ok: false });
  });

  test('the share changes only the tier being shown', () => {
    const r = editLine(line, 'multiplier', '0', opts);
    expect(r).toMatchObject({
      ok: true,
      line: { tierMultiplier: { secure: 0, independent: 1.2 } },
    });
    expect(editLine(line, 'multiplier', '-1', opts)).toMatchObject({ ok: false });
  });
});

describe('adding an item to a category', () => {
  test('counts fully at every tier', () => {
    const r = newLine(
      { categoryId: 'food.cafes', item: ' Coffee ', cost: '5.50', period: 'd' },
      { tiers: DEFAULT_TIERS, periods: DEFAULT_PERIODS, id: 'n1' }
    );
    expect(r).toEqual({
      ok: true,
      line: {
        id: 'n1',
        categoryId: 'food.cafes',
        item: 'Coffee',
        cost: 550n,
        ccy: 'AUD',
        period: 'd',
        tierMultiplier: { secure: 1, independent: 1, luxury: 1 },
      },
    });
    expect(linesIn([line, r.ok ? r.line : line], 'food.cafes')).toHaveLength(1);
  });

  test('without an amount nothing is added', () => {
    expect(
      newLine(
        { categoryId: 'food.cafes', item: 'Coffee', cost: '', period: 'd' },
        { tiers: DEFAULT_TIERS, periods: DEFAULT_PERIODS, id: 'n1' }
      )
    ).toMatchObject({ ok: false });
  });
});

describe('re-importing a sheet keeps changes made here (unless the sheet changed)', () => {
  const imported = (row: number, item: string, cents: bigint): BudgetLine => ({
    ...line,
    id: `opex.csv#${row}`,
    item,
    cost: cents,
    source: { file: 'opex.csv', row },
  });
  const rent = imported(4, 'Rent', 62000n);
  const food = imported(5, 'Groceries', 14000n);
  const other: BudgetLine = { ...line, id: 'manual-1', item: 'Gym' };

  test('the first change remembers what the sheet said; going back forgets it', () => {
    const changed = withSheet(rent, { ...rent, cost: 65000n });
    expect(changed.sheet).toEqual(rowOf(rent));
    // A second change keeps the sheet's values, not the first change's.
    expect(withSheet(changed, { ...changed, cost: 66000n }).sheet).toEqual(rowOf(rent));
    expect(withSheet(changed, { ...rent }).sheet).toBeUndefined();
    // Lines added here have no sheet.
    expect(withSheet(other, { ...other, cost: 1n }).sheet).toBeUndefined();
  });

  test('an unchanged sheet keeps the edit and the deletion', () => {
    const edited = withSheet(rent, { ...rent, cost: 65000n });
    const m = mergeReimport([edited, other], [food], 'opex.csv', [rent, food]);
    expect(m.lines).toEqual([other, edited]);
    expect(m.removed).toEqual([food]);
    expect(m.kept).toBe(2);
  });

  test('a row the sheet itself changed takes the sheet’s new values', () => {
    const edited = withSheet(rent, { ...rent, cost: 65000n });
    const newRent = { ...rent, cost: 70000n };
    const newFood = { ...food, cost: 15000n };
    const m = mergeReimport([edited], [food], 'opex.csv', [newRent, newFood]);
    expect(m.lines).toEqual([newRent, newFood]);
    expect(m.removed).toEqual([]);
    expect(m.kept).toBe(0);
  });
});
