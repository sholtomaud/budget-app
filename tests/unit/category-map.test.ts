/** Budget lines onto the app's categories: rules, then a structured output (FR-ING-019, ADR 0034). Made-up data. */
import { describe, expect, test } from 'vitest';
import {
  asLineCategories,
  categoryPrompt,
  fromCategoryAnswer,
  ruleMappings,
} from '../../src/budget/category-map.ts';
import { preview } from '../../src/budget/workbook.ts';
import { defaultCategories } from '../../src/classify/categories.ts';
import { validate } from '../../src/lib/jsonschema.ts';

const SHEET = `# x-synthetic: made-up budget
CATEGORY,Item,Cost,Unit,Fin. Secure,Fin. Indepnt,Fin. Luxury,Sub-category
HOUSING,Rent,$500,w,1,1.5,2,rental
,Body Corp,"$1,000",q,1,1,1,property
FOOD,Super.Market,$100,w,1,1,1.5,groceries
,Coffee,$4,d,1,1,2,food.cafe
UTILITIES,Elect,$100,m,1,1,2,utilities
,Water,$150,q,1,1,1,utilities
GADGETS,Laptop,"$3,000",5y,0,1,1,gadgets
,Thingamajig,$20,y,0,0,1,misc
`;
const cats = defaultCategories();
const p = preview('budget.csv', SHEET);
const row = (item: string) => p.lines.find((l) => l.item === item)!.source!.row;

describe('categories follow a standard', () => {
  test('spending categories carry their COICOP 2018 code; income and transfers do not', () => {
    const code = (id: string) => cats.find((c) => c.id === id)?.coicop;
    expect(code('housing.rent')).toBe('04.1');
    expect(code('food.groceries')).toBe('01.1');
    expect(code('comms.internet')).toBe('08.3');
    expect(code('education.fees')).toBe('10');
    expect(code('income.salary')).toBeUndefined();
    expect(code('transfer.internal')).toBeUndefined();
  });
});

describe('rules on the device', () => {
  const m = new Map(ruleMappings(p.lines, cats).map((x) => [x.row, x]));

  test('by item, then sub-category, then section; a sheet already on our categories keeps them', () => {
    expect(m.get(row('Rent'))).toMatchObject({ categoryId: 'housing.rent', by: 'rules' });
    expect(m.get(row('Body Corp'))?.categoryId).toBe('housing.strata');
    expect(m.get(row('Super.Market'))?.categoryId).toBe('food.groceries');
    expect(m.get(row('Coffee'))).toMatchObject({ categoryId: 'food.cafe', by: 'sheet' });
    expect(m.get(row('Elect'))?.categoryId).toBe('utilities.electricity');
    expect(m.get(row('Water'))?.categoryId).toBe('utilities.water');
  });

  test('what no rule knows is left for the AI or the person', () => {
    expect(m.has(row('Laptop'))).toBe(false);
    expect(m.has(row('Thingamajig'))).toBe(false);
  });
});

describe('the AI: a structured output limited to our categories', () => {
  const rest = p.lines.filter((l) => ['Laptop', 'Thingamajig'].includes(l.item));
  const q = categoryPrompt(rest, cats);

  test('the prompt has names, sections and COICOP codes, never an amount', () => {
    expect(q.user).toContain('item "Laptop", section "gadgets"');
    expect(q.user).toContain('housing.rent: Rent (COICOP 04.1)');
    expect(q.user).not.toMatch(/\$|3,000|3000/);
    expect(q.user).not.toContain('income.salary');
  });

  test('the schema allows only our spending categories or none', () => {
    expect(
      validate(q.schema, { lines: [{ row: 9, category: 'shopping.electronics' }] })
    ).toBeNull();
    expect(validate(q.schema, { lines: [{ row: 9, category: 'none' }] })).toBeNull();
    expect(validate(q.schema, { lines: [{ row: 9, category: 'gadgets.stuff' }] })).not.toBeNull();
    expect(validate(q.schema, { lines: [{ row: 9, category: 'income.salary' }] })).not.toBeNull();
  });

  test('the answer is checked: unknown rows, unknown categories, none and repeats are dropped', () => {
    const out = fromCategoryAnswer(
      {
        lines: [
          { row: row('Laptop'), category: 'shopping.electronics' },
          { row: row('Laptop'), category: 'leisure.books' },
          { row: row('Thingamajig'), category: 'none' },
          { row: 999, category: 'housing.rent' },
        ],
      },
      rest,
      cats
    );
    expect(out).toEqual([{ row: row('Laptop'), categoryId: 'shopping.electronics', by: 'ai' }]);
  });
});

describe('the importer applies them', () => {
  test('line categories by row; a category the person maps in the wizard still wins', () => {
    const maps = [
      ...ruleMappings(p.lines, cats),
      { row: row('Laptop'), categoryId: 'shopping.electronics', by: 'ai' as const },
    ];
    const q = preview('budget.csv', SHEET, { lineCategories: asLineCategories(maps) });
    const cat = (item: string) => q.lines.find((l) => l.item === item)!.categoryId;
    expect(cat('Rent')).toBe('housing.rent');
    expect(cat('Laptop')).toBe('shopping.electronics');
    expect(cat('Thingamajig')).toBe('gadgets.misc');
    const r = preview('budget.csv', SHEET, {
      lineCategories: asLineCategories(maps),
      categoryMap: { 'housing.rental': 'housing.mortgage' },
    });
    expect(r.lines.find((l) => l.item === 'Rent')!.categoryId).toBe('housing.mortgage');
  });
});
