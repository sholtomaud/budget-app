/**
 * Budget lines onto the app's categories (FR-ING-019, ADR 0034). A budget
 * from a spreadsheet names things its own way ("Super.Market" under FOOD,
 * "Elect" under UTILITIES); actual vs budget, the floor and the forecasts
 * need them on the same categories as the transactions.
 *
 *   1. Rules on the device: the item, its sub-category and its section,
 *      matched against words for each category.
 *   2. The AI, for what the rules leave: a structured output whose schema
 *      allows only the app's category ids (or "none"). It sees each line's
 *      row, item, sub-category and section, never an amount.
 *   3. The person confirms each line.
 *
 * The categories carry their COICOP 2018 codes (UN classification of
 * household consumption by purpose), a standard both sides can name.
 */
import { redactText } from '../api/redact.ts';
import type { Category } from '../classify/categories.ts';
import type { Schema } from '../lib/jsonschema.ts';
import type { BudgetLine } from './model.ts';

export type MappedBy = 'sheet' | 'rules' | 'ai' | 'you';

export interface LineMapping {
  row: number;
  categoryId: string;
  by: MappedBy;
}

/** Words for each category, tried in order; the first match wins. */
const RULES: [RegExp, string][] = [
  [/\b(mortgage|mortage|home loan)\b/, 'housing.mortgage'],
  [/\b(rent|rental|lease)\b/, 'housing.rent'],
  [/\b(body corp\w*|strata|owners corp\w*|council|rates|levies|levy)\b/, 'housing.strata'],
  [/\b(repairs?|maintenance fund|handyman|plumber)\b/, 'household.maintenance'],
  [/\b(elect\w*|power|energy)\b/, 'utilities.electricity'],
  [/\bgas\b/, 'utilities.gas'],
  [/\bwater\b/, 'utilities.water'],
  [/\b(mobile|phone|cell)\b/, 'comms.mobile'],
  [/\b(broadband|internet|nbn|wifi plan)\b/, 'comms.internet'],
  [/\b(medical insurance|health insurance|hospital cover|extras cover)\b/, 'health.insurance'],
  [
    /\b(dentist|dental|doctor|gp|physio|medical|specialist|optometrist|needles|acupunct\w*)\b/,
    'health.medical',
  ],
  [/\b(pharmacy|chemist|medicine|prescriptions?)\b/, 'health.pharmacy'],
  [/\b(gym|yoga|tennis|pilates|fitness|swim\w*|sport)\b/, 'health.gym'],
  [/\b(super ?\.? ?market|groceries|grocery|food shop\w*)\b/, 'food.groceries'],
  [/\b(coffee|cafe|caf\w)\b/, 'food.cafe'],
  [/\b(lunch|dinners?|restaurant|takeaway|take-away|eating out|bars?)\b/, 'food.dining'],
  [/\b(fuel|petrol|diesel)\b/, 'transport.fuel'],
  [/\b(ptransport|public transport|myki|opal|train|bus|tram)\b/, 'transport.public'],
  [/\b(uber|taxi|rideshare)\b/, 'transport.rideshare'],
  [/\b(bike|bicycle)\b/, 'transport.bicycle'],
  [/\b(car|rego|registration|tyres?)\b/, 'transport.car'],
  [/\b(flights?|holidays?|travel|trips?)\b/, 'leisure.travel'],
  [/\b(movies?|cinema|concerts?|entertainment|theatre)\b/, 'leisure.entertainment'],
  [/\b(books?)\b/, 'leisure.books'],
  [/\b(streaming|netflix|spotify|media)\b/, 'subscriptions.media'],
  [/\b(software|cloud|app subscriptions?)\b/, 'subscriptions.software'],
  [/\b(uni fees|tuition|school fees|education fees)\b/, 'education.fees'],
  [/\b(course|courses|openlearn|learning|education)\b/, 'education.courses'],
  [
    /\b(clothes|clothing|shirts?|pants|jeans|shorts|shoes|jacket|hoodie|socks|under\w*|suit|thermals|t-shirt|scarf|uggs|ties|cufflinks)\b/,
    'shopping.clothing',
  ],
  [/\b(dry cleaning|laundry)\b/, 'shopping.clothing'],
  [/\b(clippers|nail|haircut|barber|grooming|toiletries|massage)\b/, 'personal.care'],
  [/\b(sheets|bedding|towels|furniture|furnishings)\b/, 'household.furnishings'],
  [/\b(stationery|pens?|notebooks?)\b/, 'shopping.stationery'],
  [/\b(umbrella|homewares)\b/, 'shopping.homewares'],
  [/\b(bank fees?|account fees?)\b/, 'fees.bank'],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_.]+/g, ' ')
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The section and sub-category a line came with: the importer files it as section.sub. */
export function lineParts(l: BudgetLine): { section: string; sub: string } {
  const [section = '', ...rest] = l.categoryId.split('.');
  return { section: section.replace(/-/g, ' '), sub: rest.join(' ').replace(/-/g, ' ') };
}

/**
 * Categories for budget lines, by rules. A line already on one of the app's
 * categories keeps it ("sheet"); lines no rule matches are left out.
 */
export function ruleMappings(
  lines: readonly BudgetLine[],
  categories: readonly Category[]
): LineMapping[] {
  const known = new Set(categories.map((c) => c.id));
  const out: LineMapping[] = [];
  for (const l of lines) {
    const row = l.source?.row;
    if (row === undefined) continue;
    if (known.has(l.categoryId)) {
      out.push({ row, categoryId: l.categoryId, by: 'sheet' });
      continue;
    }
    const { section, sub } = lineParts(l);
    // The item says most; then the sub-category; then the section.
    for (const text of [l.item, sub, section].map(norm).filter(Boolean)) {
      const hit = RULES.find(([re, id]) => re.test(text) && known.has(id));
      if (hit) {
        out.push({ row, categoryId: hit[1], by: 'rules' });
        break;
      }
    }
  }
  return out;
}

export interface CategoryPrompt {
  system: string;
  user: string;
  schema: Schema;
}

/** The AI's question for lines the rules left (FR-ING-019): no amounts, only names. */
export function categoryPrompt(
  lines: readonly BudgetLine[],
  categories: readonly Category[]
): CategoryPrompt {
  const spending = categories.filter(
    (c) => !/^(income|investment|transfer|tax)\./.test(c.id) && c.kind !== 'income'
  );
  const ids = spending.map((c) => c.id);
  const schema: Schema = {
    type: 'object',
    additionalProperties: false,
    required: ['lines'],
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['row', 'category'],
          properties: {
            row: { type: 'integer' },
            category: { type: 'string', enum: [...ids, 'none'] },
          },
        },
      },
    },
  };
  const catalogue = spending
    .map((c) => {
      const code = c.coicop;
      return `${c.id}: ${c.name}${code ? ` (COICOP ${code})` : ''}`;
    })
    .join('\n');
  const rows = lines
    .filter((l) => l.source)
    .map((l) => {
      const { section, sub } = lineParts(l);
      return `${l.source!.row}: item "${redactText(l.item).slice(0, 60)}", section "${section}", sub-category "${sub}"`;
    })
    .join('\n');
  return {
    schema,
    system:
      'You file the lines of a household budget under a fixed list of spending categories, each tagged with its COICOP 2018 code (the UN classification of household consumption by purpose). For each row, pick the one category that fits best, or "none" if none does. Use only the listed ids. Answer only with the requested JSON.',
    user: `Categories:\n${catalogue}\n\nBudget lines (row: item, section, sub-category):\n${rows}`,
  };
}

/** The AI's answer, checked: only rows that were asked about, only known categories. */
export function fromCategoryAnswer(
  answer: { lines: { row: number; category: string }[] },
  lines: readonly BudgetLine[],
  categories: readonly Category[]
): LineMapping[] {
  const asked = new Set(lines.map((l) => l.source?.row));
  const known = new Set(categories.map((c) => c.id));
  const seen = new Set<number>();
  const out: LineMapping[] = [];
  for (const a of answer.lines) {
    if (!asked.has(a.row) || seen.has(a.row) || !known.has(a.category)) continue;
    seen.add(a.row);
    out.push({ row: a.row, categoryId: a.category, by: 'ai' });
  }
  return out;
}

/** Mappings as the importer takes them: row → category. */
export const asLineCategories = (m: readonly LineMapping[]): Record<number, string> =>
  Object.fromEntries(m.map((x) => [x.row, x.categoryId]));
