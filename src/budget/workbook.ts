/**
 * Budget workbook import from CSV, one file per sheet (§6.2, ADR 0003).
 * A mapping step, not a hard-coded layout: the sheet type and column mapping
 * are detected from headers, previewed, and can be changed before commit.
 */
import type { Asset } from '../domain/types.ts';
import { parseCsv } from '../lib/csv.ts';
import { isoDate } from '../lib/dates.ts';
import { DEFAULT_PERIODS, perWeek, type PeriodTable } from './periods.ts';
import { DEFAULT_TIERS, type BudgetLine, type Tier } from './model.ts';

export type SheetType = 'opex' | 'capex' | 'wishlist' | 'renewals' | 'goal';

interface FieldDef {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
}

export const FIELDS: Record<SheetType, FieldDef[]> = {
  opex: [
    { key: 'category', label: 'Category (section)', aliases: ['category', 'section', 'group'] },
    {
      key: 'item',
      label: 'Item',
      aliases: ['item', 'description', 'name', 'expense'],
      required: true,
    },
    { key: 'cost', label: 'Cost', aliases: ['cost', 'amount', 'price', 'value'], required: true },
    {
      key: 'unit',
      label: 'Unit (period)',
      aliases: ['unit', 'period', 'frequency', 'per'],
      required: true,
    },
    { key: 'startDate', label: 'Start date', aliases: ['start date', 'start'] },
    { key: 'renewDate', label: 'Renew date', aliases: ['renew date', 'renewal', 'renew'] },
    {
      key: 'subCategory',
      label: 'Sub-category',
      aliases: ['sub-category', 'subcategory', 'sub category', 'category id'],
    },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment'] },
    { key: 'url', label: 'URL', aliases: ['url', 'link'] },
  ],
  capex: [
    { key: 'sourceYear', label: 'Source year', aliases: ['source year', 'year'] },
    { key: 'item', label: 'Item', aliases: ['item', 'asset', 'name'], required: true },
    { key: 'forecast', label: 'Forecast spend', aliases: ['forecast spend', 'forecast', 'budget'] },
    { key: 'paid', label: 'Paid?', aliases: ['paid?', 'paid', 'bought'] },
    { key: 'datePaid', label: 'Date paid', aliases: ['date paid', 'purchased', 'purchase date'] },
    { key: 'actual', label: 'Actual spend', aliases: ['actual spend', 'actual', 'cost'] },
    { key: 'life', label: 'Expected life (years)', aliases: ['expected life', 'life', 'lifespan'] },
    { key: 'replacementYear', label: 'Replacement year', aliases: ['replacement year', 'replace'] },
    { key: 'url', label: 'Product URL', aliases: ['product url', 'url', 'link'] },
  ],
  wishlist: [
    { key: 'item', label: 'Item', aliases: ['item', 'name'], required: true },
    { key: 'url', label: 'Link', aliases: ['link', 'url'] },
    { key: 'config', label: 'Config', aliases: ['config', 'configuration', 'spec'] },
    { key: 'toggle', label: 'Toggle', aliases: ['toggle', 'include', 'on'] },
    { key: 'price', label: 'Price', aliases: ['price'] },
    { key: 'forecast', label: 'Forecast spend', aliases: ['forecast spend', 'forecast'] },
    { key: 'datePaid', label: 'Date paid', aliases: ['date paid'] },
    { key: 'actual', label: 'Actual spend', aliases: ['actual spend', 'actual'] },
  ],
  renewals: [
    { key: 'item', label: 'Item', aliases: ['item', 'name'], required: true },
    { key: 'date', label: 'Date', aliases: ['date', 'renewed'], required: true },
    { key: 'cost', label: 'Cost', aliases: ['cost', 'amount'] },
  ],
  goal: [
    {
      key: 'field',
      label: 'Field',
      aliases: ['field', 'item', 'name', 'parameter'],
      required: true,
    },
    { key: 'value', label: 'Value', aliases: ['value', 'amount'], required: true },
  ],
};

const SIGNATURES: Record<SheetType, string[]> = {
  opex: ['unit', 'fin. secure', 'fin. indepnt', 'fin. luxury', 'cost', 'renew date'],
  capex: [
    'forecast spend',
    'paid?',
    'expected life',
    'replacement year',
    'actual spend',
    'source year',
  ],
  wishlist: ['toggle', 'config', 'price', 'link'],
  renewals: ['date', 'item', 'cost'],
  goal: ['field', 'value'],
};

export const ERROR_LITERALS = [
  '#DIV/0!',
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#NAME?',
  '#NUM!',
  '#NULL!',
  '#SPILL!',
  '#CALC!',
];

/** Sheet types in plain words. */
export const SHEET_LABEL: Record<SheetType, string> = {
  opex: 'OPEX budget',
  capex: 'CAPEX register',
  wishlist: 'Wish list',
  renewals: 'Renewals',
  goal: 'Goal / retirement',
};

export interface Mapping {
  type: SheetType;
  headerRow: number;
  /** Field key → column index. */
  columns: Record<string, number>;
  /** Column index → tier id, for OPEX tier multipliers. */
  tierColumns: Record<number, string>;
}

export interface Issue {
  row: number;
  column?: string;
  message: string;
}

export interface WorkbookPreview {
  file: string;
  mapping: Mapping;
  headers: string[];
  lines: BudgetLine[];
  assets: Asset[];
  renewals: { item: string; date: string; cost?: bigint; source: { file: string; row: number } }[];
  goal: Record<string, { value: string; row: number }>;
  issues: Issue[];
  /** Per tier, minor units per week: computed from the lines, and as the file's own totals row says. */
  totals: Record<string, { computed: number; file?: number; matches?: boolean }>;
  categoryIds: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function dataRows(rows: string[][]): { rows: string[][]; firstLine: number } {
  // Lines starting with '#' are comments (the synthetic marker, notes).
  return { rows, firstLine: 1 };
}

function isComment(r: string[]): boolean {
  return (r[0] ?? '').trimStart().startsWith('#');
}

function isBlank(r: string[]): boolean {
  return r.every((c) => c.trim() === '');
}

/** Detect the sheet type and column mapping from the header row. */
export function detect(rows: string[][]): Mapping {
  let best: { type: SheetType; score: number; headerRow: number } = {
    type: 'opex',
    score: -1,
    headerRow: 0,
  };
  // The header need not be the first row: exported sheets often start with a
  // title row ("OUTGOINGS (CONSUMPTION or EXPENSES)"). The best-scoring of the
  // first 20 rows wins; the first row only if nothing scores better.
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i]!;
    if (isComment(r) || isBlank(r)) continue;
    const headers = r.map(norm);
    for (const type of Object.keys(SIGNATURES) as SheetType[]) {
      const sig = SIGNATURES[type].filter((h) => headers.includes(h)).length;
      const fields = FIELDS[type].filter((f) => f.aliases.some((a) => headers.includes(a))).length;
      const score = sig * 3 + fields;
      if (score > best.score) best = { type, score, headerRow: i };
    }
  }
  return mappingFor(rows, best.type, best.headerRow);
}

export function mappingFor(rows: string[][], type: SheetType, headerRow: number): Mapping {
  const headers = (rows[headerRow] ?? []).map(norm);
  const columns: Record<string, number> = {};
  const used = new Set<number>();
  for (const f of FIELDS[type]) {
    for (const alias of f.aliases) {
      const idx = headers.findIndex((h, i) => h === alias && !used.has(i));
      if (idx >= 0) {
        columns[f.key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  const tierColumns: Record<number, string> = {};
  if (type === 'opex') {
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      // "Fin Secure (wk)" is the sheet's own weekly total, not a multiplier.
      if (/\(wk\)|\bwk\b|week|normalis|normaliz|total/.test(h)) return;
      if (/secure/.test(h)) tierColumns[i] = 'secure';
      else if (/indep/.test(h)) tierColumns[i] = 'independent';
      else if (/lux/.test(h)) tierColumns[i] = 'luxury';
    });
  }
  return { type, headerRow, columns, tierColumns };
}

/** "$1,234.50", "(12.00)", "1 200" → minor units; undefined if not a number. */
export function parseMoney(s: string): bigint | undefined {
  let t = s
    .trim()
    .replace(/[$\s,]/g, '')
    .replace(/^AUD/i, '');
  if (!t) return undefined;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return undefined;
  const frac = (m[2] ?? '').padEnd(2, '0');
  // Round half up beyond cents, without floats.
  let v = BigInt(m[1]! + frac.slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) v += 1n;
  return neg ? -v : v;
}

/** 2025-03-14, 14/03/2025 or 14/3/25 (Australian day-first) → ISO date. */
export function parseDate(s: string): string | undefined {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
    return isoDate(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})$/.exec(t);
  if (m) return `${m[1]}-01-01`;
  return undefined;
}

const CAPEX_KEYWORDS: [RegExp, string][] = [
  [/laptop|computer|macbook|phone|ipad|tablet|monitor|pc\b/i, 'capex.computing'],
  [/camera|lens|tripod/i, 'capex.photography'],
  [/watch|pen\b|fountain|jewel/i, 'capex.personal'],
  [/bike|bicycle|e-bike|car\b|scooter|vehicle/i, 'capex.transport'],
  [/sofa|couch|bed|desk|chair|table|furniture|mattress/i, 'capex.furniture'],
  [/holiday|trip|travel|flight|vacation/i, 'capex.travel'],
  [/fridge|washing|dishwasher|vacuum|oven|appliance|dryer/i, 'capex.appliances'],
];

export function guessCapexCategory(item: string): string {
  return CAPEX_KEYWORDS.find(([re]) => re.test(item))?.[1] ?? 'capex.other';
}

export interface PreviewOptions {
  mapping?: Mapping;
  periods?: PeriodTable;
  tiers?: Tier[];
  /** Imported category id → app category id. */
  categoryMap?: Record<string, string>;
  defaultLife?: (categoryId: string) => { meanYears: number; shape: number };
  synthetic?: boolean;
}

/** Parse a CSV sheet into a preview (FR-ING-010…014). Pure; nothing is stored. */
export function preview(file: string, text: string, opts: PreviewOptions = {}): WorkbookPreview {
  const all = parseCsv(text);
  const { rows } = dataRows(all);
  const mapping = opts.mapping ?? detect(rows);
  const headers = rows[mapping.headerRow] ?? [];
  const periods = opts.periods ?? DEFAULT_PERIODS;
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const issues: Issue[] = [];
  const lines: BudgetLine[] = [];
  const assets: Asset[] = [];
  const renewals: WorkbookPreview['renewals'] = [];
  const goal: WorkbookPreview['goal'] = {};
  const fileTotals: Record<string, number> = {};
  const col = (r: string[], key: string) => {
    const i = mapping.columns[key];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const synthetic = opts.synthetic ?? (all[0]?.[0] ?? '').startsWith('# x-synthetic');
  const provenance = synthetic ? 'illustrative' : 'budgeted';
  let section = '';

  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNo = i + 1; // 1-based, as a spreadsheet shows it
    if (isComment(r) || isBlank(r)) continue;
    // FR-ING-011: error literals are reported and skipped.
    const errorCells = r
      .map((c, j) => [c.trim(), j] as const)
      .filter(([c]) => ERROR_LITERALS.includes(c.toUpperCase()));
    for (const [c, j] of errorCells)
      issues.push({
        row: rowNo,
        column: headers[j] ?? `column ${j + 1}`,
        message: `Cell holds ${c}; skipped`,
      });
    const errorCols = new Set(errorCells.map(([, j]) => j));
    const source = { file, row: rowNo };

    if (mapping.type === 'opex') {
      const first = (r[0] ?? '').trim();
      // A totals row ends the budget: sheets often keep calculators below it.
      if (/^totals?\b/i.test(first) || /^totals?\b/i.test(col(r, 'item'))) {
        for (const [idx, tier] of Object.entries(mapping.tierColumns)) {
          const v = parseMoney(r[Number(idx)] ?? '');
          if (v !== undefined) fileTotals[tier] = Number(v);
        }
        break;
      }
      const item = col(r, 'item');
      const costCell = col(r, 'cost');
      // A section label sits in the category column, alone or beside the first item.
      // An amount there is a stray calculation, not a section.
      const cat = col(r, 'category');
      if (cat && parseMoney(cat) === undefined) section = cat;
      if (!item && !costCell) continue;
      if (mapping.columns.cost !== undefined && errorCols.has(mapping.columns.cost)) continue;
      const cost = parseMoney(costCell);
      if (cost === undefined) {
        issues.push({
          row: rowNo,
          column: 'Cost',
          message: `"${costCell}" is not an amount; row skipped`,
        });
        continue;
      }
      const unit = col(r, 'unit');
      if (!unit) {
        issues.push({
          row: rowNo,
          column: 'Unit',
          message: `No period for "${item || costCell}"; row skipped (a note or a calculation?)`,
        });
        continue;
      }
      if (perWeek(unit, periods) === undefined) {
        issues.push({
          row: rowNo,
          column: 'Unit',
          message: `Unknown period "${unit}"; row skipped (add it to the period table)`,
        });
        continue;
      }
      const tierMultiplier: Record<string, number> = {};
      for (const t of tiers) tierMultiplier[t.id] = 1;
      for (const [idx, tier] of Object.entries(mapping.tierColumns)) {
        const raw = (r[Number(idx)] ?? '').trim();
        if (raw === '' || errorCols.has(Number(idx))) continue;
        const v = Number(raw.replace('%', '')) / (raw.endsWith('%') ? 100 : 1);
        if (Number.isFinite(v)) tierMultiplier[tier] = v;
        else
          issues.push({
            row: rowNo,
            column: headers[Number(idx)],
            message: `"${raw}" is not a multiplier; 1 used`,
          });
      }
      const sub = col(r, 'subCategory');
      const sectionId = slug(section || 'other');
      let categoryId = sub.includes('.') ? sub : `${sectionId}.${slug(sub || item)}`;
      categoryId = opts.categoryMap?.[categoryId] ?? categoryId;
      const line: BudgetLine = {
        id: `${file}#${rowNo}`,
        categoryId,
        item,
        cost,
        ccy: 'AUD',
        period: unit,
        tierMultiplier,
        source,
      };
      const sd = parseDate(col(r, 'startDate'));
      const rd = parseDate(col(r, 'renewDate'));
      if (sd) line.startDate = sd;
      if (rd) line.renewDate = rd;
      if (col(r, 'notes')) line.notes = col(r, 'notes');
      if (col(r, 'url')) line.url = col(r, 'url');
      lines.push(line);
    } else if (mapping.type === 'capex' || mapping.type === 'wishlist') {
      const item = col(r, 'item');
      if (!item) continue;
      if (mapping.type === 'wishlist' && /^(no|false|0|off)$/i.test(col(r, 'toggle'))) continue;
      const paidDate = parseDate(col(r, 'datePaid'));
      const paid =
        mapping.type === 'capex'
          ? /^(y|yes|true|1|paid)$/i.test(col(r, 'paid')) || !!paidDate
          : !!paidDate;
      const forecast = parseMoney(col(r, 'forecast')) ?? parseMoney(col(r, 'price'));
      const actual = parseMoney(col(r, 'actual'));
      const cost = (paid ? (actual ?? forecast) : (forecast ?? actual)) ?? 0n;
      let categoryId = guessCapexCategory(item);
      categoryId = opts.categoryMap?.[categoryId] ?? categoryId;
      const lifeRaw = Number(col(r, 'life'));
      const def = opts.defaultLife?.(categoryId) ?? { meanYears: 5, shape: 2.5 };
      const lifeAssumed = !(lifeRaw > 0);
      const asset: Asset = {
        id: `${file}#${rowNo}`,
        name: item,
        categoryId,
        cost: { minor: cost, ccy: 'AUD' },
        life: { meanYears: lifeAssumed ? def.meanYears : lifeRaw, shape: def.shape },
        lifeAssumed,
        replace: true,
        status: paid ? 'owned' : mapping.type === 'wishlist' ? 'wish' : 'planned',
        linkedTxnIds: [],
        source,
        provenance,
      };
      if (paidDate) asset.purchasedAt = paidDate;
      else if (paid) asset.purchasedAt = parseDate(col(r, 'sourceYear')) ?? undefined;
      if (forecast !== undefined && !paid) asset.forecastCost = { minor: forecast, ccy: 'AUD' };
      if (col(r, 'url')) asset.url = col(r, 'url');
      if (lifeAssumed)
        issues.push({
          row: rowNo,
          column: 'Expected Life',
          message: `No expected life; ${def.meanYears} years assumed (FR-CAP-005)`,
        });
      assets.push(asset);
    } else if (mapping.type === 'renewals') {
      const item = col(r, 'item');
      const date = parseDate(col(r, 'date'));
      if (!item || !date) {
        issues.push({ row: rowNo, message: 'Needs an item and a date; row skipped' });
        continue;
      }
      const cost = parseMoney(col(r, 'cost'));
      renewals.push({ item, date, ...(cost !== undefined ? { cost } : {}), source });
    } else {
      const field = col(r, 'field');
      if (field) goal[field] = { value: col(r, 'value'), row: rowNo };
    }
  }

  // One asset per item: rows for the same item are its purchase history; keep the latest.
  const merged = new Map<string, Asset>();
  for (const a of assets) {
    const k = a.name.toLowerCase();
    const prev = merged.get(k);
    if (!prev || (a.purchasedAt ?? '') >= (prev.purchasedAt ?? '')) merged.set(k, a);
  }

  const totals: WorkbookPreview['totals'] = {};
  if (mapping.type === 'opex') {
    for (const t of tiers) {
      let computed = 0;
      for (const l of lines)
        computed +=
          Number(l.cost) * (perWeek(l.period, periods) ?? 0) * (l.tierMultiplier[t.id] ?? 1);
      const file = fileTotals[t.id];
      totals[t.id] = {
        computed,
        ...(file !== undefined
          ? { file, matches: Math.abs(computed - file) <= Math.abs(file) * 0.005 }
          : {}),
      };
    }
  }
  return {
    file,
    mapping,
    headers,
    lines,
    assets: [...merged.values()],
    renewals,
    goal,
    issues,
    totals,
    categoryIds: [
      ...new Set([
        ...lines.map((l) => l.categoryId),
        ...[...merged.values()].map((a) => a.categoryId),
      ]),
    ].sort(),
  };
}
