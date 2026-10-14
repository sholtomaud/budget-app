/**
 * Budgets exported from a spreadsheet like the project owner's (title row,
 * weekly-total columns, a calculator under TOTALS), and the floor plans are
 * held to: the Secure tier's budget (ADR 0033). All figures are made up.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_PERIODS, perWeek } from '../../src/budget/periods.ts';
import { DEFAULT_TIERS, weeklyRate } from '../../src/budget/model.ts';
import { emptyBudget } from '../../src/budget/state.ts';
import { isBudgetSheet, preview } from '../../src/budget/workbook.ts';
import type { Txn } from '../../src/domain/types.ts';
import { essentialsFrom, minTierSpend, spendingFrom } from '../../src/sim/inputs.ts';

const SHEET = `# x-synthetic: made-up budget in a spreadsheet-export layout
OUTGOINGS (CONSUMPTION or EXPENSES),,,FXRATE,"$1,234",,,,,,,,,,,,,DATE CONVERSIONS,Lookup,wk
CATEGORY,Item,Cost,Unit,Start Date,Renew Date,Normalise to Weeks,Fin. Secure,Fin. Indepnt,Fin. Luxury,Fin Secure (wk),Fin. Ind. (wk),Fin. Lux. (wk),Sub-category,Notes,,,days,d,7
HOUSING,Mortgage,$0,w,9/2/2021,9/9/2021,,1,1.5,2,#VALUE!,#VALUE!,#VALUE!,property,,,,weeks,w,1
,Rent,$500,w,8/30/2021,9/6/2021,$500.00,1,1.5,3,$500.00,$750.00,"$1,500.00",rental,,"$26,000",,months,m,0.23
,TAX,25%,y,9/2/2021,9/2/2022,$0.01,0,0,1,$0.00,$0.00,$0.01,tax,,,,years,y,0.02
FOOD,,,,,,,,,,,,,,,,,,,
,Groceries,$100,w,8/29/2021,9/5/2021,$100.00,1,1,1.5,$100.00,$100.00,$150.00,groceries,,,,,,
,Lunch,$10,d,9/3/2021,9/4/2021,$70.00,0,1,2,$0.00,$70.00,$140.00,lunch,,,,,,
TRANSPORT,,,,,,,,,,#VALUE!,#VALUE!,#VALUE!,,,,,,,
,Car,$100,w,9/2/2021,9/9/2021,$100.00,0,0,1,$0.00,$0.00,$100.00,transport,,,,,,
"$5,200.00",Bike,$520,y,9/2/2021,9/2/2022,$10.00,0,1,1,$0.00,$10.00,$10.00,transport,,,,,,
GADGETS,,,,,,,,,,,,,,,,,,,
Node,Mini PC,$300,3y,1/2/2016,1/1/2019,$1.92,0,1,2,$0.00,$1.92,$3.84,computing,,,,,,
,cable,$15,,,,,,,,,,,,,,,,,
,,$315,,,,,,,,,,,,,,,,,
,TOTALS,,,,,,,,wk,#VALUE!,#VALUE!,#VALUE!,,,,,,,
Quick calc,week,total,,Time,,,,,y,#VALUE!,,,,,,,,,
rent,$400.00,"$8,000.00",,start,31 Aug 2025,,,,m,#VALUE!,,,,,,,,,
SAVINGS,,"$10,000.00",,,,,,,inflation rate,3.00%,,0.03,,,,,,,
`;

const per = (c: string) => perWeek(c, DEFAULT_PERIODS);

describe('a spreadsheet-export budget (FR-ING-010…014)', () => {
  const p = preview('budget.csv', SHEET);

  test('the header is found below a title row; multipliers, not the weekly totals', () => {
    expect(p.mapping.type).toBe('opex');
    expect(p.mapping.headerRow).toBe(2);
    expect(Object.values(p.mapping.tierColumns)).toEqual(['secure', 'independent', 'luxury']);
    expect(Object.keys(p.mapping.tierColumns).map(Number)).toEqual([7, 8, 9]);
  });

  test('budget lines up to TOTALS; notes, calculations and the calculator below are skipped', () => {
    expect(p.lines.map((l) => l.item)).toEqual([
      'Mortgage',
      'Rent',
      'Groceries',
      'Lunch',
      'Car',
      'Bike',
      'Mini PC',
    ]);
    // The #VALUE! cells are all in the weekly-total columns the import doesn't read: not reported.
    expect(p.issues.map((i) => i.message)).toEqual([
      '"25%" is not an amount; row skipped',
      'No period for "cable"; row skipped (a note or a calculation?)',
      'No period for "$315"; row skipped (a note or a calculation?)',
    ]);
  });

  test('sections carry down; a stray amount in the category column is not one; a label beside an item is', () => {
    const cat = (item: string) => p.lines.find((l) => l.item === item)!.categoryId;
    expect(cat('Rent')).toBe('housing.rental');
    expect(cat('Bike')).toBe('transport.transport');
    expect(cat('Mini PC')).toBe('node.computing');
  });

  test('a tier is each line times its multiplier; 0 leaves a line out of that tier', () => {
    const week = (tier: string) => p.lines.reduce((a, l) => a + weeklyRate(l, tier, per), 0) / 100;
    expect(week('secure')).toBeCloseTo(600, 0); // rent 500 + groceries 100
    expect(week('independent')).toBeCloseTo(750 + 100 + 70 + 10 + 1.92, 0);
    expect(week('luxury')).toBeGreaterThan(week('independent'));
  });
});

describe('the floor: the Secure budget (ADR 0033)', () => {
  const p = preview('budget.csv', SHEET);
  const budget = { ...emptyBudget(), lines: p.lines, tiers: DEFAULT_TIERS };
  const household = (txns: Txn[] = []) => ({
    accounts: [],
    balances: [],
    txns,
    assets: [],
    budget,
  });

  test('every Secure line at its multiplier; luxury-only lines add nothing', () => {
    const e = essentialsFrom(household())!;
    expect(e.source).toBe('budgeted');
    expect(e.tier).toBe('Secure');
    expect(e.monthly).toBeCloseTo((600 * 52) / 12, 0);
    expect(e.top[0]!.categoryId).toBe('housing.rental');
    expect(e.top.map((t) => t.categoryId)).not.toContain('transport.transport');
  });

  test('a higher tier may come down to Secure, not below', () => {
    const sp = spendingFrom(household(), 'independent');
    const lever = minTierSpend(sp, 1);
    const independent = Object.values(sp.tier).reduce((a, b) => a + b, 0);
    expect(independent * lever).toBeGreaterThanOrEqual(sp.essentials!.monthly - 0.01);
    expect(lever).toBeLessThan(1);
    // At Secure itself, there's no room below.
    expect(minTierSpend(spendingFrom(household(), 'secure'), 1)).toBe(1);
  });

  test('rent paid well above the Secure budget flags the budget as out of date', () => {
    const months = ['2025-01', '2025-02', '2025-03'];
    const txns: Txn[] = months.flatMap((m, i) =>
      [1, 8, 15, 22].map((d) => ({
        id: `r${i}-${d}`,
        accountId: 'SYN-A',
        idSynthetic: false,
        status: 'POSTED' as const,
        cdrType: 'PAYMENT',
        date: `${m}-${String(d).padStart(2, '0')}`,
        amount: -70_000n,
        currency: 'AUD',
        description: 'Rent',
        importIds: ['i1'],
        provenance: 'illustrative' as const,
        classification: {
          kind: 'opex' as const,
          categoryId: 'housing.rent',
          confidence: 1,
          by: 'rule' as const,
        },
      }))
    );
    txns.push({ ...txns[0]!, id: 'end', date: '2025-03-31', amount: -1n });
    const e = essentialsFrom(household(txns))!;
    expect(e.outdated?.[0]?.group).toBe('housing');
    expect(e.outdated![0]!.actual).toBeGreaterThan(e.outdated![0]!.budgeted);
  });

  test('with no budget, what the essentials cost stands in', () => {
    const none = { ...household(), budget: emptyBudget() };
    expect(essentialsFrom(none)).toBeUndefined();
  });
});

describe('a budget sheet chosen on the Import screen goes to the Budget screen', () => {
  test('tier columns make a budget sheet; bank statements are not one', () => {
    expect(isBudgetSheet(SHEET)).toBe(true);
    const bank = (rows: string[]) => ['# x-synthetic: bank', ...rows].join('\n');
    expect(isBudgetSheet(bank(['01/03/2026,+2500.00,SALARY,+3500.00']))).toBe(false);
    expect(
      isBudgetSheet(bank(['Date,Amount,Description,Balance', '01/03/2026,-45.10,GROCER,3454.90']))
    ).toBe(false);
    expect(isBudgetSheet(bank(['Date,Item,Cost', '2026-03-01,Insurance,$500']))).toBe(false);
  });
});
